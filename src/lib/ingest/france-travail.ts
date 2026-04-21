import { insertJobs, type NewJob } from '@/lib/db';

// Ce connecteur ne parle PAS directement à France Travail : il passe par
// un Worker Cloudflare qui détient les credentials OAuth2 comme secrets.
// L'app locale n'a besoin que de l'URL du Worker et d'un secret partagé.

export interface IngestResult {
  source: 'france_travail';
  fetched: number;
  inserted: number;
  error?: string;
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

// Convertit une offre France Travail vers notre format de DB.
function mapOffre(offre: FTOffre): NewJob {
  // Département extrait des 2 premiers chiffres du code postal (fonctionne
  // pour tous les départements IDF ; à adapter si on élargit à la Corse).
  const codePostal = offre.lieuTravail?.codePostal;
  const departement =
    codePostal && /^\d{5}$/.test(codePostal) ? codePostal.slice(0, 2) : null;

  return {
    source: 'france_travail',
    source_url:
      offre.origineOffre?.urlOrigine ??
      `https://candidat.francetravail.fr/offres/recherche/detail/${offre.id}`,
    // Certaines offres anonymes n'ont pas de nom d'entreprise.
    company_name: offre.entreprise?.nom ?? 'Non communiqué',
    job_title: offre.intitule,
    location: offre.lieuTravail?.libelle ?? null,
    posted_at: offre.dateCreation,
    departement,
    sector: offre.secteurActiviteLibelle ?? null,
    rome_label: offre.romeLibelle ?? null,
  };
}

export async function ingestFranceTravail(): Promise<IngestResult> {
  const workerUrl = process.env.FRANCE_TRAVAIL_WORKER_URL;
  const workerKey = process.env.FRANCE_TRAVAIL_WORKER_KEY;

  if (!workerUrl || !workerKey) {
    const error =
      'FRANCE_TRAVAIL_WORKER_URL ou FRANCE_TRAVAIL_WORKER_KEY manquant dans .env';
    console.error(`[france-travail] ${error}`);
    return { source: 'france_travail', fetched: 0, inserted: 0, error };
  }

  try {
    const minDate = startOfTodayParisIso();
    const url = `${workerUrl.replace(/\/$/, '')}/offres?minCreationDate=${encodeURIComponent(minDate)}`;
    console.log(`[france-travail] appel du Worker (offres depuis ${minDate})`);

    const res = await fetch(url, { headers: { 'X-API-Key': workerKey } });
    if (!res.ok) {
      throw new Error(`Worker a répondu ${res.status} : ${await res.text()}`);
    }
    const data = (await res.json()) as WorkerResponse;
    const jobs = data.offres.map(mapOffre);
    const inserted = insertJobs(jobs);
    console.log(
      `[france-travail] ${jobs.length} offres récupérées, ${inserted} nouvelles insérées`,
    );
    return { source: 'france_travail', fetched: jobs.length, inserted };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[france-travail] ${error}`);
    return { source: 'france_travail', fetched: 0, inserted: 0, error };
  }
}
