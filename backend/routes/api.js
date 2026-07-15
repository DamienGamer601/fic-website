const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const discord = require('../discord');

const TRUCKY_API = 'https://e.truckyapp.com/api/v1';
let statsCache = { data: null, fetchedAt: 0 };
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

module.exports = function (db) {
  const router = express.Router();

  function requireAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Non connecté' });
    try {
      const payload = jwt.verify(token, process.env.SESSION_SECRET);
      req.discordId = payload.discordId;
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Session invalide ou expirée' });
    }
  }

  function currentDriver(req) {
    return db.get('drivers').find({ discordId: req.discordId }).value();
  }

  function requireStaff(req, res, next) {
    const driver = currentDriver(req);
    if (!driver || !driver.isStaff) return res.status(403).json({ error: 'Réservé au staff' });
    next();
  }

  // --- Profil de l'utilisateur connecté ---
  router.get('/me', requireAuth, (req, res) => {
    const driver = currentDriver(req);
    if (!driver) return res.status(404).json({ error: 'Profil introuvable' });
    res.json(driver);
  });

  // --- L'utilisateur lie son pseudo en jeu (TruckyApp / TruckersMP) pour retrouver ses stats perso ---
  router.patch('/me', requireAuth, (req, res) => {
    const { gameUsername } = req.body;
    const target = db.get('drivers').find({ discordId: req.discordId });
    if (!target.value()) return res.status(404).json({ error: 'Profil introuvable' });
    target.assign({ gameUsername: gameUsername || null }).write();
    res.json(target.value());
  });

  // --- Admin : liste des chauffeurs en attente de validation ---
  router.get('/admin/pending', requireAuth, requireStaff, (req, res) => {
    res.json(db.get('drivers').filter({ status: 'pending' }).value());
  });

  router.get('/admin/drivers', requireAuth, requireStaff, (req, res) => {
    res.json(db.get('drivers').value());
  });

  router.post('/admin/validate/:discordId', requireAuth, requireStaff, async (req, res) => {
    const admin = currentDriver(req);
    const target = db.get('drivers').find({ discordId: req.params.discordId });
    if (!target.value()) return res.status(404).json({ error: 'Chauffeur introuvable' });

    target.assign({
      status: 'validated',
      validatedBy: admin.username,
      validatedAt: new Date().toISOString(),
    }).write();

    discord.assignDriverRole(req.params.discordId);
    res.json({ ok: true });
  });

  router.post('/admin/refuse/:discordId', requireAuth, requireStaff, (req, res) => {
    const admin = currentDriver(req);
    const target = db.get('drivers').find({ discordId: req.params.discordId });
    if (!target.value()) return res.status(404).json({ error: 'Chauffeur introuvable' });

    target.assign({
      status: 'refused',
      validatedBy: admin.username,
      validatedAt: new Date().toISOString(),
    }).write();

    res.json({ ok: true });
  });

  // --- Équipe (page Meet the team, publique) ---
  router.get('/team', (req, res) => {
    res.json(db.get('team').sortBy('order').value());
  });

  // --- Convois : liste publique, triée par date ---
  router.get('/convoys', (req, res) => {
    const convoys = db.get('convoys').sortBy('date').value();
    res.json(convoys);
  });

  // --- Convois : création par le staff ---
  router.post('/admin/convoys', requireAuth, requireStaff, (req, res) => {
    const { title, date, departure, destination, description, discordEventUrl } = req.body;
    if (!title || !date) return res.status(400).json({ error: 'Titre et date requis' });

    const convoy = {
      id: Date.now().toString(),
      title,
      date, // ISO string attendue (date + heure)
      departure: departure || '',
      destination: destination || '',
      description: description || '',
      discordEventUrl: discordEventUrl || '',
      createdAt: new Date().toISOString(),
    };
    db.get('convoys').push(convoy).write();
    res.json(convoy);
  });

  // --- Convois : suppression par le staff ---
  router.delete('/admin/convoys/:id', requireAuth, requireStaff, (req, res) => {
    db.get('convoys').remove({ id: req.params.id }).write();
    res.json({ ok: true });
  });

  // --- Recrutement : soumission d'une candidature ---
  router.post('/recrutement', async (req, res) => {
    const { pseudo, discordTag, age, jeu, experience, disponibilites, motivation } = req.body;
    if (!pseudo || !discordTag || !motivation) {
      return res.status(400).json({ error: 'Champs requis manquants' });
    }

    const application = {
      id: Date.now().toString(),
      pseudo,
      discordTag,
      age: age || null,
      jeu: jeu || 'ETS2',
      experience: experience || '',
      disponibilites: disponibilites || '',
      motivation,
      status: 'nouvelle',
      createdAt: new Date().toISOString(),
    };
    db.get('applications').push(application).write();

    if (process.env.DISCORD_RECRUIT_WEBHOOK_URL) {
      try {
        await axios.post(process.env.DISCORD_RECRUIT_WEBHOOK_URL, {
          embeds: [{
            title: 'Nouvelle candidature FIC',
            color: 0x59100B,
            fields: [
              { name: 'Pseudo', value: pseudo, inline: true },
              { name: 'Discord', value: discordTag, inline: true },
              { name: 'Jeu', value: application.jeu, inline: true },
              { name: 'Expérience', value: experience || 'Non renseigné' },
              { name: 'Disponibilités', value: disponibilites || 'Non renseigné' },
              { name: 'Motivation', value: motivation.slice(0, 1000) },
            ],
            timestamp: new Date().toISOString(),
          }],
        });
      } catch (err) {
        console.error('Webhook recrutement échoué:', err.message);
      }
    }

    res.json({ ok: true });
  });

  // --- Statistiques VTC via TruckyApp (avec cache 5 min) ---
  // On reformate la réponse brute de TruckyApp (champs verbeux, pagination imbriquée,
  // données techniques internes) en un format simple et stable pour le frontend.
  router.get('/stats', async (req, res) => {
    const now = Date.now();
    if (statsCache.data && now - statsCache.fetchedAt < CACHE_TTL_MS) {
      return res.json(statsCache.data);
    }

    if (!process.env.TRUCKY_API_TOKEN || !process.env.TRUCKY_COMPANY_ID) {
      return res.status(503).json({
        error: 'API TruckyApp non configurée (TRUCKY_API_TOKEN / TRUCKY_COMPANY_ID manquants dans .env)',
      });
    }

    try {
      const headers = {
        'x-access-token': process.env.TRUCKY_API_TOKEN,
        Accept: 'application/json',
        'User-Agent': 'FIC-Website',
      };
      const companyId = process.env.TRUCKY_COMPANY_ID;

      const [companyRes, membersRes, jobsRes] = await Promise.all([
        axios.get(`${TRUCKY_API}/company/${companyId}`, { headers }),
        axios.get(`${TRUCKY_API}/company/${companyId}/members`, { headers }),
        axios.get(`${TRUCKY_API}/company/${companyId}/jobs`, { headers, params: { per_page: 1 } }).catch(() => null),
      ]);

      const c = companyRes.data;
      const rawMembers = membersRes.data?.data || [];

      const members = rawMembers.map(m => ({
        id: m.id,
        name: m.name,
        avatarUrl: m.avatar_url,
        level: m.level ?? null,
        points: m.points ?? null,
        distanceKm: Math.round(m.total_driven_distance_km || 0),
        revenue: m.total_revenue || 0,
        lastJobDays: m.last_job_days ?? null,
        roleName: m.role?.name || null,
        roleColor: m.role?.color || null,
        rankName: m.rank?.name || null,
        rankColor: m.rank?.color || null,
        tags: (m.company_tags || []).map(t => ({ name: t.name, color: t.color })),
        publicUrl: m.public_url || null,
      })).sort((a, b) => b.distanceKm - a.distanceKm);

      const totalDistance = members.reduce((sum, m) => sum + m.distanceKm, 0);
      const totalRevenue = members.reduce((sum, m) => sum + m.revenue, 0);

      const payload = {
        company: {
          name: c.name,
          tag: c.tag,
          slogan: c.slogan,
          about: c.about,
          avatarUrl: c.avatar_url,
          coverUrl: c.cover_url,
          discord: c.discord,
          twitter: c.twitter,
          twitch: c.twitch,
          youtube: c.youtube,
          recruitment: c.recruitment,
          requirements: c.requirements,
          publicUrl: c.public_url,
          currency: c.currency || 'T¢',
        },
        totals: {
          distanceKm: totalDistance,
          revenue: totalRevenue,
          jobs: jobsRes?.data?.total ?? null,
          members: c.members_count ?? members.length,
        },
        members,
      };

      statsCache = { data: payload, fetchedAt: now };
      res.json(payload);
    } catch (err) {
      console.error('Erreur TruckyApp:', err.response?.data || err.message);
      res.status(502).json({ error: 'Impossible de récupérer les statistiques TruckyApp' });
    }
  });

  return router;
};
