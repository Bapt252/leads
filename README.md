# leads

Outil interne de prospection B2B pour **Tenex** (plateforme de recrutement).

## Objectif

Ingérer les offres d'emploi publiées en **Île-de-France** sur **France Travail**,
**Indeed** et **LinkedIn**, les afficher dans une liste unique, permettre de
marquer une vue entière en « prospecté » en un clic, et exporter la sélection
courante en CSV.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript strict
- Tailwind CSS v4
- SQLite local via `better-sqlite3` — fichier `leads.db` à la racine (gitignored)
- `zod` pour valider les payloads d'ingestion

Pas d'auth : outil local, lancé via `npm run dev` sur la machine de l'utilisateur.

## Prérequis

- Node.js ≥ 20 (testé avec 22.14)
- npm

## Setup

```bash
npm install
cp .env.example .env
# Renseigner les variables au fur et à mesure que les connecteurs seront branchés.
npm run dev
```

Ouvrir http://localhost:3000.

## État d'avancement

- ✅ Liste des offres, filtre `new` / `prospected` / `all`
- ✅ Bouton « Tout marquer prospecté » (bascule groupée de la vue courante)
- ✅ Export CSV de la vue courante (`/api/export?status=…`)
- ⏳ Connecteurs d'ingestion : **squelettes vides** renvoyant 0 offre
  - `/api/ingest/france-travail` — à brancher à l'API France Travail (OAuth2)
  - `/api/ingest/indeed` — approche à choisir (pas d'API publique officielle)
  - `/api/ingest/linkedin` — approche à choisir (pas d'API publique officielle)

## Commandes

- `npm run dev` — serveur de développement
- `npm run build` — build de production
- `npm run start` — serveur de production
- `npm run lint` — ESLint

## Déploiement

Prévu sur Vercel (à venir). Attention : `better-sqlite3` ne fonctionne pas sur
du serverless sans filesystem persistant — le jour où on déploie, il faudra
basculer sur Turso / Neon, ou garder l'outil strictement en local.
