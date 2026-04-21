# leads-france-travail — Worker Cloudflare

Proxy minimal qui tient les credentials France Travail comme secrets
Cloudflare et expose un endpoint `/offres` protégé par un header
`X-API-Key`.

Appelé par l'app Next.js `leads/` via `FRANCE_TRAVAIL_WORKER_URL` +
`FRANCE_TRAVAIL_WORKER_KEY`.

## Déploiement initial

```bash
cd worker
npm install
npx wrangler login           # ouvre le navigateur, autorise l'accès
npx wrangler deploy          # premier push, crée le Worker sur ton compte
```

Puis injecter les 3 secrets (ils ne sont PAS dans wrangler.jsonc) :

```bash
npx wrangler secret put FRANCE_TRAVAIL_CLIENT_ID
npx wrangler secret put FRANCE_TRAVAIL_CLIENT_SECRET
npx wrangler secret put SHARED_API_KEY
```

Pour `SHARED_API_KEY`, générer un secret aléatoire :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copier la même valeur dans le `.env` de l'app Next.js à la racine du
repo :

```
FRANCE_TRAVAIL_WORKER_URL=https://leads-france-travail.<ton-sous-domaine>.workers.dev
FRANCE_TRAVAIL_WORKER_KEY=<la même valeur que SHARED_API_KEY>
```

## Redéploiements

```bash
cd worker
npx wrangler deploy
```

## Logs

```bash
npx wrangler tail
```
