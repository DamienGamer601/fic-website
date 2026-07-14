require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

const adapter = new FileSync(path.join(__dirname, 'data', 'db.json'));
const db = low(adapter);
db.defaults({ drivers: [], team: [], applications: [], convoys: [] }).write();

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));

// IMPORTANT : montée AVANT express.json() — la vérification de signature Discord
// a besoin du corps brut (raw) de la requête, pas du JSON déjà parsé.
// Optionnel : n'active la validation par boutons Discord que si la clé publique est configurée.
if (process.env.DISCORD_PUBLIC_KEY) {
  app.use('/discord', require('./routes/interactions')(db));
} else {
  console.log('DISCORD_PUBLIC_KEY non configurée : validation par boutons Discord désactivée (le panneau web reste disponible).');
}

app.use(express.json());

app.use('/auth', require('./routes/auth')(db));
app.use('/api', require('./routes/api')(db));

app.get('/', (req, res) => res.json({ status: 'FIC API en ligne' }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`FIC backend démarré sur le port ${PORT}`));
