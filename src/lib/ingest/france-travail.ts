import { insertJobs, type NewJob } from '@/lib/db';

// Endpoint OAuth2 "partenaire" de France Travail (ex-Pôle emploi).
const TOKEN_URL =
  'https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire';

// Endpoint de recherche d'offres v2.
const SEARCH_URL =
  'https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search';

// Les 8 départements d'Île-de-France.
const IDF_DEPARTEMENTS = '75,77,78,91,92,93,94,95';

// L'API plafonne à 150 résultats par requête et 3000 au total via `range`.
const PAGE_SIZE = 150;
const MAX_OFFSET = 3000;

export interface IngestResult {
  source: 'france_travail';
  fetched: number;
  inserted: number;
  error?: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

interface FTOffre {
  id: string;
  intitule: string;
  dateCreation: string;
  lieuTravail?: { libelle?: string };
  entreprise?: { nom?: string };
  origineOffre?: { urlOrigine?: string };
}

interface FTSearchResponse {
  resultats?: FTOffre[];
}

// Récupère un access_token via client_credentials.
async function getAccessToken(
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'api_offresdemploiv2 o2dsoffre',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(
      `OAuth2 France Travail a échoué: ${res.status} ${await res.text()}`,
    );
  }
  const data = (await res.json()) as TokenResponse;
  return data.access_token;
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
  // `longOffset` renvoie "GMT+02:00" en été, "GMT+01:00" en hiver.
  const offset = offsetRaw.replace('GMT', '') || '+00:00';
  return new Date(`${year}-${month}-${day}T00:00:00${offset}`)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z');
}

// Récupère une page de résultats (range inclusif : 0-149 = 150 offres).
async function searchPage(
  token: string,
  minCreationDate: string,
  start: number,
  end: number,
): Promise<FTOffre[]> {
  const url = new URL(SEARCH_URL);
  url.searchParams.set('departement', IDF_DEPARTEMENTS);
  url.searchParams.set('minCreationDate', minCreationDate);
  url.searchParams.set('range', `${start}-${end}`);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  // 204 = aucune offre sur cette plage (peut arriver sur une plage hors bornes).
  if (res.status === 204) return [];
  // 200 si tout rentre, 206 s'il reste des résultats au-delà du range.
  if (res.status !== 200 && res.status !== 206) {
    throw new Error(
      `Recherche France Travail a échoué: ${res.status} ${await res.text()}`,
    );
  }
  const data = (await res.json()) as FTSearchResponse;
  return data.resultats ?? [];
}

// Convertit une offre France Travail vers notre format de DB.
function mapOffre(offre: FTOffre): NewJob {
  return {
    source: 'france_travail',
    source_url:
      offre.origineOffre?.urlOrigine ??
      `https://candidat.francetravail.fr/offres/recherche/detail/${offre.id}`,
    // Certaines offres (intérim anonyme, confidentielles) n'ont pas de nom d'entreprise.
    company_name: offre.entreprise?.nom ?? 'Non communiqué',
    job_title: offre.intitule,
    location: offre.lieuTravail?.libelle ?? null,
    posted_at: offre.dateCreation,
  };
}

export async function ingestFranceTravail(): Promise<IngestResult> {
  const clientId = process.env.FRANCE_TRAVAIL_CLIENT_ID;
  const clientSecret = process.env.FRANCE_TRAVAIL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    const error =
      'FRANCE_TRAVAIL_CLIENT_ID ou FRANCE_TRAVAIL_CLIENT_SECRET manquant dans .env';
    console.error(`[france-travail] ${error}`);
    return { source: 'france_travail', fetched: 0, inserted: 0, error };
  }

  try {
    const token = await getAccessToken(clientId, clientSecret);
    const minDate = startOfTodayParisIso();
    console.log(
      `[france-travail] token OK, recherche depuis ${minDate} sur IDF (${IDF_DEPARTEMENTS})`,
    );

    const allOffres: FTOffre[] = [];
    // Boucle de pagination : 0-149, 150-299, ... jusqu'à 2850-2999.
    for (let start = 0; start + PAGE_SIZE <= MAX_OFFSET; start += PAGE_SIZE) {
      const end = start + PAGE_SIZE - 1;
      const page = await searchPage(token, minDate, start, end);
      allOffres.push(...page);
      // Si la page est incomplète, on a atteint la fin.
      if (page.length < PAGE_SIZE) break;
    }

    const jobs = allOffres.map(mapOffre);
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
