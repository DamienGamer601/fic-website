const axios = require('axios');

const API = 'https://discord.com/api/v10';

// Échange le code OAuth2 contre un access token
async function exchangeCode(code) {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    client_secret: process.env.DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
  });
  const { data } = await axios.post(`${API}/oauth2/token`, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return data; // { access_token, token_type, expires_in, refresh_token, scope }
}

// Récupère le profil de l'utilisateur connecté avec son access_token
async function fetchUser(accessToken) {
  const { data } = await axios.get(`${API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data; // { id, username, discriminator, avatar, global_name, ... }
}

// Vérifie si l'utilisateur possède le rôle Staff sur le serveur (via le bot)
async function getGuildMemberRoles(discordUserId) {
  if (!process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_GUILD_ID) return [];
  try {
    const { data } = await axios.get(
      `${API}/guilds/${process.env.DISCORD_GUILD_ID}/members/${discordUserId}`,
      { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } }
    );
    return data.roles || [];
  } catch (err) {
    return []; // le membre n'est pas (ou plus) sur le serveur
  }
}

async function isStaff(discordUserId) {
  if (!process.env.DISCORD_STAFF_ROLE_ID) return false;
  const roles = await getGuildMemberRoles(discordUserId);
  return roles.includes(process.env.DISCORD_STAFF_ROLE_ID);
}

// Attribue le rôle "Chauffeur validé" une fois la validation faite par le staff
async function assignDriverRole(discordUserId) {
  if (!process.env.DISCORD_DRIVER_ROLE_ID) return;
  try {
    await axios.put(
      `${API}/guilds/${process.env.DISCORD_GUILD_ID}/members/${discordUserId}/roles/${process.env.DISCORD_DRIVER_ROLE_ID}`,
      {},
      { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } }
    );
  } catch (err) {
    console.error('Impossible d\'assigner le rôle chauffeur:', err.response?.data || err.message);
  }
}

function avatarUrl(user) {
  if (!user.avatar) {
    const idx = user.discriminator && user.discriminator !== '0'
      ? Number(user.discriminator) % 5
      : Number(BigInt(user.id) >> 22n) % 6;
    return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
  }
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
}

// Poste un message avec boutons Valider/Refuser dans le salon staff quand un
// nouveau chauffeur se connecte pour la première fois.
async function postPendingApplication(driver) {
  if (!process.env.DISCORD_STAFF_CHANNEL_ID) return;
  try {
    await axios.post(
      `${API}/channels/${process.env.DISCORD_STAFF_CHANNEL_ID}/messages`,
      {
        embeds: [{
          title: 'Nouvelle demande d\'accès chauffeur',
          description: `<@${driver.discordId}> vient de se connecter à l'Espace Chauffeurs du site.`,
          color: 0x59100b,
          thumbnail: { url: driver.avatar },
          fields: [
            { name: 'Pseudo Discord', value: driver.username, inline: true },
            { name: 'Statut', value: '⏳ En attente', inline: true },
          ],
          timestamp: new Date().toISOString(),
        }],
        components: [{
          type: 1,
          components: [
            { type: 2, style: 3, label: 'Valider', custom_id: `validate_driver:${driver.discordId}` },
            { type: 2, style: 4, label: 'Refuser', custom_id: `refuse_driver:${driver.discordId}` },
          ],
        }],
      },
      { headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` } }
    );
  } catch (err) {
    console.error('Impossible de poster la demande dans Discord:', err.response?.data || err.message);
  }
}

module.exports = { exchangeCode, fetchUser, isStaff, getGuildMemberRoles, assignDriverRole, avatarUrl, postPendingApplication };
