require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

const adapter = new FileSync(path.join(__dirname, 'data', 'db.json'));
const db = low(adapter);
db.defaults({ drivers: [], team: [], applications: [] }).write();

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 jours
    },
  })
);

app.use('/auth', require('./routes/auth')(db));
app.use('/api', require('./routes/api')(db));

app.get('/', (req, res) => res.json({ status: 'FIC API en ligne' }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`FIC backend démarré sur le port ${PORT}`));
