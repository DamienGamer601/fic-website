const express = require('express');
const jwt = require('jsonwebtoken');
const discord = require('../discord');

module.exports = function (db) {
  const router = express.Router();

  // Étape 1 : redirige l'utilisateur vers Discord pour l'autorisation
  router.get('/discord', (req, res) => {
    const params = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      redirect_uri: process.env.DISCORD_REDIRECT_URI,
      response_type: 'code',
      scope: 'identify',
      prompt: 'consent',
    });
    res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
  });

  // Étape 2 : Discord redirige ici avec un code. On échange le code, on crée/maj le
  // chauffeur, puis on renvoie un token signé au frontend via l'URL (pas de cookie
  // cross-domain : plus fiable entre deux sous-domaines onrender.com différents).
  router.get('/discord/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect(`${process.env.FRONTEND_URL}/espace-chauffeurs.html?error=no_code`);

    try {
      const token = await discord.exchangeCode(code);
      const profile = await discord.fetchUser(token.access_token);
      const staff = await discord.isStaff(profile.id);

      let driver = db.get('drivers').find({ discordId: profile.id }).value();

      if (!driver) {
        driver = {
          discordId: profile.id,
          username: profile.global_name || profile.username,
          tag: profile.discriminator !== '0' ? `${profile.username}#${profile.discriminator}` : profile.username,
          avatar: discord.avatarUrl(profile),
          status: 'pending', // pending | validated | refused
          isStaff: staff,
          joinedAt: new Date().toISOString(),
          validatedBy: null,
          validatedAt: null,
        };
        db.get('drivers').push(driver).write();
        discord.postPendingApplication(driver);
      } else {
        driver.username = profile.global_name || profile.username;
        driver.avatar = discord.avatarUrl(profile);
        driver.isStaff = staff;
        db.get('drivers').find({ discordId: profile.id }).assign(driver).write();
      }

      const sessionToken = jwt.sign(
        { discordId: profile.id },
        process.env.SESSION_SECRET,
        { expiresIn: '30d' }
      );

      res.redirect(`${process.env.FRONTEND_URL}/espace-chauffeurs.html?token=${sessionToken}`);
    } catch (err) {
      console.error('Erreur OAuth Discord:', err.response?.data || err.message);
      res.redirect(`${process.env.FRONTEND_URL}/espace-chauffeurs.html?error=auth_failed`);
    }
  });

  return router;
};
