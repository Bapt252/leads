// Script d'enrichissement des leads exécuté par GitHub Actions.
// Appelle le Worker Cloudflare France Travail, merge delta dans leads.json.
// Règle de merge : sur offre déjà connue (même id), on ne touche jamais aux
// champs user (status, contact_*, notes, prospected_at). On ne backfill que
// les champs source qui étaient null (departement, sector, rome_label).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const LEADS_PATH = 'public/data/leads.json';

export type JobSource = 'france_travail';
export type JobStatus = 'new' | 'prospected';

export interface Job {
  id: string;
  source: JobSource;
  source_url: string | null;
  company_name: string;
  job_title: string;
  location: string | null;
  posted_at: string | null;
  departement: string | null;
  sector: string | null;
  rome_label: string | null;
  status: JobStatus;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  prospected_at: string | null;
  created_at: string;
}

export interface LeadsStore {
  version: 1;
  updated_at: string;
  jobs: Job[];
}

interface FTOffre {
  id: string;
  intitule: string;
  dateCreation: string;
  lieuTravail?: { libelle?: string; codePostal?: string };
  entreprise?: { nom?: string };
  origineOffre?: { urlOrigine?: string };
  secteurActiviteLibelle?: string;
  romeLibelle?: string;
}

interface WorkerResponse {
  offres: FTOffre[];
  count: number;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[enrich] variable d'environnement manquante : ${name}`);
    process.exit(1);
  }
  return v;
}

// Retourne l'ISO UTC correspondant à 00h00 aujourd'hui heure de Paris.
function startOfTodayParisIso(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZoneName: 'longOffset',
  }).formatToParts(now);
  const year = parts.find((p) => p.type === 'year')!.value;
  const month = parts.find((p) => p.type === 'month')!.value;
  const day = parts.find((p) => p.type === 'day')!.value;
  const offsetRaw = parts.find((p) => p.type === 'timeZoneName')!.value;
  const offset = offsetRaw.replace('GMT', '') || '+00:00';
  return new Date(`${year}-${month}-${day}T00:00:00${offset}`)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z');
}

async function loadStore(): Promise<LeadsStore> {
  try {
    const raw = await readFile(LEADS_PATH, 'utf-8');
    return JSON.parse(raw) as LeadsStore;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.log('[enrich] leads.json absent, initialisation');
      return { version: 1, updated_at: new Date().toISOString(), jobs: [] };
    }
    throw err;
  }
}

async function saveStore(store: LeadsStore): Promise<void> {
  await mkdir(dirname(LEADS_PATH), { recursive: true });
  await writeFile(LEADS_PATH, JSON.stringify(store, null, 2) + '\n', 'utf-8');
}

type SourceFields = Pick<
  Job,
  | 'id'
  | 'source'
  | 'source_url'
  | 'company_name'
  | 'job_title'
  | 'location'
  | 'posted_at'
  | 'departement'
  | 'sector'
  | 'rome_label'
>;

function mapOffre(offre: FTOffre): SourceFields {
  // Département = 2 premiers chiffres du code postal (IDF uniquement pour l'instant).
  const codePostal = offre.lieuTravail?.codePostal;
  const departement =
    codePostal && /^\d{5}$/.test(codePostal) ? codePostal.slice(0, 2) : null;
  return {
    id: `ft:${offre.id}`,
    source: 'france_travail',
    source_url:
      offre.origineOffre?.urlOrigine ??
      `https://candidat.francetravail.fr/offres/recherche/detail/${offre.id}`,
    company_name: offre.entreprise?.nom ?? 'Non communiqué',
    job_title: offre.intitule,
    location: offre.lieuTravail?.libelle ?? null,
    posted_at: offre.dateCreation,
    departement,
    sector: offre.secteurActiviteLibelle ?? null,
    rome_label: offre.romeLibelle ?? null,
  };
}

async function fetchOffres(): Promise<FTOffre[]> {
  const workerUrl = requireEnv('FRANCE_TRAVAIL_WORKER_URL');
  const workerKey = requireEnv('FRANCE_TRAVAIL_WORKER_KEY');
  const minDate = startOfTodayParisIso();
  const url = `${workerUrl.replace(/\/$/, '')}/offres?minCreationDate=${encodeURIComponent(minDate)}`;
  console.log(`[enrich] appel Worker FT (offres depuis ${minDate})`);
  const res = await fetch(url, { headers: { 'X-API-Key': workerKey } });
  if (!res.ok) {
    throw new Error(`Worker FT a répondu ${res.status} : ${await res.text()}`);
  }
  const data = (await res.json()) as WorkerResponse;
  console.log(`[enrich] ${data.count} offres reçues`);
  return data.offres;
}

function mergeDelta(
  store: LeadsStore,
  offres: FTOffre[],
): { added: number; touched: number } {
  const now = new Date().toISOString();
  let added = 0;
  let touched = 0;
  const byId = new Map(store.jobs.map((j) => [j.id, j]));

  for (const offre of offres) {
    const source = mapOffre(offre);
    const existing = byId.get(source.id);
    if (existing) {
      // Backfill uniquement des champs qui étaient null (cohérent avec la
      // logique insertJobs d'origine en SQLite).
      existing.departement ??= source.departement;
      existing.sector ??= source.sector;
      existing.rome_label ??= source.rome_label;
      touched++;
    } else {
      const job: Job = {
        ...source,
        status: 'new',
        contact_name: null,
        contact_email: null,
        contact_phone: null,
        notes: null,
        prospected_at: null,
        created_at: now,
      };
      store.jobs.push(job);
      byId.set(job.id, job);
      added++;
    }
  }

  store.updated_at = now;
  return { added, touched };
}

async function main(): Promise<void> {
  const store = await loadStore();
  const offres = await fetchOffres();
  const { added, touched } = mergeDelta(store, offres);
  await saveStore(store);
  console.log(
    `[enrich] +${added} nouvelles, ${touched} existantes revues (total : ${store.jobs.length})`,
  );
}

main().catch((err) => {
  console.error('[enrich] erreur fatale :', err);
  process.exit(1);
});
