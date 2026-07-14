const express = require('express');
const { verifyKeyMiddleware, InteractionType, InteractionResponseType } = require('discord-interactions');
const discord = require('../discord');

// Réponse "ephémère" (visible uniquement par la personne qui a cliqué)
const EPHEMERAL = 1 << 6;

module.exports = function (db) {
  const router = express.Router();

  router.post(
    '/interactions',
    verifyKeyMiddleware(process.env.DISCORD_PUBLIC_KEY),
    async (req, res) => {
      const interaction = req.body;

      // Discord vérifie que l'endpoint répond correctement lors de la configuration
      if (interaction.type === InteractionType.PING) {
        return res.send({ type: InteractionResponseType.PONG });
      }

      if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
        const [action, discordId] = (interaction.data.custom_id || '').split(':');
        if (!['validate_driver', 'refuse_driver'].includes(action) || !discordId) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: 'Action inconnue.', flags: EPHEMERAL },
          });
        }

        const memberRoles = interaction.member?.roles || [];
        const isStaffMember = process.env.DISCORD_STAFF_ROLE_ID && memberRoles.includes(process.env.DISCORD_STAFF_ROLE_ID);

        if (!isStaffMember) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: "Tu n'as pas la permission de valider les chauffeurs.", flags: EPHEMERAL },
          });
        }

        const target = db.get('drivers').find({ discordId });
        if (!target.value()) {
          return res.send({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: 'Ce chauffeur est introuvable en base (déjà traité ?).', flags: EPHEMERAL },
          });
        }

        const staffUser = interaction.member.user;
        const staffName = staffUser.global_name || staffUser.username;
        const newStatus = action === 'validate_driver' ? 'validated' : 'refused';

        target.assign({
          status: newStatus,
          validatedBy: staffName,
          validatedAt: new Date().toISOString(),
        }).write();

        if (newStatus === 'validated') discord.assignDriverRole(discordId);

        const original = interaction.message.embeds?.[0] || {};
        const statusLabel = newStatus === 'validated' ? '✅ Validé' : '❌ Refusé';
        const statusColor = newStatus === 'validated' ? 0x3d8b5f : 0xb23a2e;
        const fields = (original.fields || []).map(f =>
          f.name === 'Statut' ? { ...f, value: `${statusLabel} par ${staffName}` } : f
        );

        return res.send({
          type: InteractionResponseType.UPDATE_MESSAGE,
          data: {
            embeds: [{ ...original, color: statusColor, fields }],
            components: [], // on retire les boutons une fois traité
          },
        });
      }

      res.status(400).json({ error: "Type d'interaction non géré" });
    }
  );

  return router;
};
