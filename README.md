# leads

Outil interne de prospection B2B pour **Tenex** (plateforme de recrutement).

## Objectif

Ingérer les offres d'emploi publiées en **Île-de-France** sur **France Travail**,
les afficher dans une liste unique, permettre de marquer chaque offre comme
« prospecté » avec un contact, et exporter la sélection courante en CSV.

## Architecture

Site 100% statique (GitHub Pages) avec persistance via commits dans le repo :

```
┌─ GitHub Pages (bapt252.github.io/leads) ─ site static Next.js
│     │
│     ↓ fetch (lecture publique, sans auth)
│  public/data/leads.json  ← source unique dans le repo
│     ↑ écrit                     ↑ écrit
│  Cloudflare Worker           GitHub Actions (cron journalier)
│  (PATCH user fields           (enrich.ts : appel API France Travail
│   via API GitHub)              + merge delta dans leads.json)
└───────────────────────────────────────────────────────────────────
```

## Stack

- Next.js 16 (App Router, export static) + React 19 + TypeScript strict
- Tailwind CSS v4
- Cloudflare Worker (proxy API France Travail + proxy écriture GitHub)
- GitHub Actions (cron enrichissement + déploiement Pages)

## Prérequis

- Node.js ≥ 20
- npm
- Compte Cloudflare + compte GitHub (pour les Workers et GitHub Pages)

## Développement local

```bash
npm install
# Créer un .env avec l'URL du Worker :
# NEXT_PUBLIC_WORKER_URL=https://leads-france-travail.baptiste-coma.workers.dev
npm run dev
```

Ouvrir http://localhost:3000. Au premier write, le site demande la clé API
Worker (stockée dans localStorage).

## Commandes

- `npm run dev` — serveur de développement
- `npm run build` — build de production (export static dans `out/`)
- `npm run lint` — ESLint
- `npm run enrich` — lance le script d'enrichissement en local (nécessite
  `FRANCE_TRAVAIL_WORKER_URL` et `FRANCE_TRAVAIL_WORKER_KEY` dans l'env)

## Déploiement

Tout est automatisé via GitHub Actions :

| Workflow | Déclencheur | Action |
|---|---|---|
| `enrich.yml` | Cron 6h UTC + bouton UI | Appelle l'API FT, merge delta, commit `leads.json` |
| `deploy.yml` | Push sur `main` | Build static + publie sur GitHub Pages |

### Secrets GitHub Actions à configurer

Settings → Secrets and variables → Actions :
- `FRANCE_TRAVAIL_WORKER_URL` (secret)
- `FRANCE_TRAVAIL_WORKER_KEY` (secret — vs `SHARED_API_KEY` du Worker)
- `NEXT_PUBLIC_WORKER_URL` (variable, pas secret — exposée au bundle)

### Secrets Cloudflare Worker à configurer

Via le dashboard Cloudflare (Worker `leads-france-travail` → Settings) :
- `FRANCE_TRAVAIL_CLIENT_ID`
- `FRANCE_TRAVAIL_CLIENT_SECRET`
- `SHARED_API_KEY` — clé partagée pour l'auth X-API-Key
- `GITHUB_KEY` — PAT fine-grained avec droit Contents R/W sur ce repo uniquement

Le repo cible (`Bapt252/leads`) est hardcodé dans le code du Worker.

## Endpoints du Worker

| Méthode | Chemin | Rôle |
|---|---|---|
| GET | `/offres?minCreationDate=…` | Proxy API France Travail (utilisé par `enrich.ts`) |
| POST | `/ingest/france-travail` | Déclenche manuellement le workflow `enrich.yml` |
| PATCH | `/leads/:id` | Modifie les champs user (status, contact_*, notes) d'une offre |
| POST | `/leads/mark-all-prospected` | Body `{ ids: string[] }` — bascule en masse |

Tous les endpoints exigent le header `X-API-Key` = `SHARED_API_KEY`.
