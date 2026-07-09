# Site web — FR | Industries Corporation (FIC)

Site complet pour la VTC : accueil, recrutement, statistiques (TruckyApp), équipe, et Espace Chauffeurs avec connexion Discord validée manuellement par le staff.

## Structure

```
fic-website/
├── backend/          Express API (OAuth2 Discord, validation staff, proxy TruckyApp)
│   ├── server.js
│   ├── discord.js
│   ├── routes/auth.js      → /auth/discord, /auth/discord/callback, /auth/logout
│   ├── routes/api.js       → /api/me, /api/admin/*, /api/team, /api/stats, /api/recrutement
│   ├── data/db.json         base de données (fichier JSON, lowdb)
│   └── .env.example
└── frontend/          Site statique (HTML/CSS/JS, aucun framework)
    ├── index.html, recrutement.html, statistiques.html, equipe.html, espace-chauffeurs.html
    ├── css/style.css
    └── js/config.js, nav.js
```

## 1. Configurer Discord

1. Va sur https://discord.com/developers/applications → New Application.
2. Onglet **OAuth2** : note le `Client ID` et le `Client Secret`, ajoute une Redirect URI :
   `http://localhost:3001/auth/discord/callback` (en local) et l'équivalent en prod (ex: `https://fic-backend.onrender.com/auth/discord/callback`).
3. Onglet **Bot** : crée un bot, récupère son token, et invite-le sur ton serveur Discord avec la permission **View Server Members** (scope `bot`, permission `View Channels` suffit pour lire les rôles).
4. Sur ton serveur Discord, active le **mode développeur** (Paramètres > Avancés), puis clic droit sur ton serveur et sur le rôle "Staff" pour copier leurs IDs.

## 2. Configurer le backend

```bash
cd backend
cp .env.example .env
```

Remplis `.env` avec :
- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`
- `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_STAFF_ROLE_ID` (obligatoire pour que le panneau d'administration s'affiche), `DISCORD_DRIVER_ROLE_ID` (optionnel, rôle auto-attribué à la validation)
- `TRUCKY_COMPANY_ID=82` (déjà rempli, c'est l'ID de ta page https://hub.truckyapp.com/company/82) et `TRUCKY_API_TOKEN` (à récupérer sur hub.truckyapp.com > Company Settings > Integrations > Claim API Company Access Token)
- `SESSION_SECRET` : une longue chaîne aléatoire

Puis :
```bash
npm install
npm start
```
Le backend tourne sur `http://localhost:3001`.

## 3. Lancer le frontend

Le frontend est 100% statique. En local, ouvre `frontend/index.html` avec un petit serveur (ex. l'extension VS Code "Live Server", ou `npx serve frontend`) plutôt qu'en `file://` pour que les cookies de session fonctionnent bien.

Dans `frontend/js/config.js`, vérifie que `API_BASE` pointe vers ton backend.

## 4. Déploiement (comme pour FIC Tools)

- **Backend** → Render (Web Service), variables d'environnement = celles du `.env`. Pense à mettre `FRONTEND_URL` sur l'URL réelle de ton site et à repasser `DISCORD_REDIRECT_URI` sur l'URL Render dans le Discord Developer Portal.
- **Frontend** → n'importe quel hébergeur statique (GitHub Pages, Render Static Site, Netlify...). Mets à jour `API_BASE` dans `config.js` avec l'URL Render du backend.
- Passe les cookies de session en `secure: true` (déjà géré automatiquement via `NODE_ENV=production`), et sers le site en HTTPS.

## 5. Comment fonctionne la validation manuelle

1. Un chauffeur clique sur "Se connecter avec Discord" → OAuth2 → il est créé en base avec le statut `pending`.
2. Il voit un message "Candidature en attente" tant qu'il n'est pas validé.
3. Un membre ayant le rôle Discord `DISCORD_STAFF_ROLE_ID` voit apparaître un panneau **Chauffeurs en attente de validation** sur la même page, avec les boutons **Valider** / **Refuser**.
4. Une fois validé, le chauffeur voit son accès débloqué au prochain chargement, et reçoit automatiquement le rôle `DISCORD_DRIVER_ROLE_ID` sur Discord si configuré.

## 6. Personnaliser l'équipe

Édite `backend/data/db.json`, tableau `team`, un objet par membre :
```json
{ "id": "2", "name": "Pseudo", "role": "Responsable Recrutement", "avatar": "https://...", "bio": "...", "order": 2 }
```

## À faire avant la mise en ligne

- [ ] Remplacer le contenu de `team` dans `db.json` par la vraie équipe
- [ ] Configurer le webhook Discord de recrutement (`DISCORD_RECRUIT_WEBHOOK_URL`) pour recevoir les candidatures directement sur le serveur
- [ ] Ajouter un vrai logo dans `frontend/img/` et l'utiliser à la place du bloc texte "FIC" dans le header
- [ ] Vérifier les champs retournés par l'API TruckyApp (`/api/stats`) une fois le token configuré — les noms de champs peuvent varier légèrement, ajuste `statistiques.html` si besoin
"# fic-website" 
