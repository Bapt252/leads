// Worker Cloudflare qui proxifie l'API France Travail.
// Détient les credentials OAuth2 comme "secrets" Cloudflare et expose
// un endpoint /offres protégé par une clé partagée (header X-API-Key).

interface Env {
  FRANCE_TRAVAIL_CLIENT_ID: string;
  FRANCE_TRAVAIL_CLIENT_SECRET: string;
  SHARED_API_KEY: string;
}

const TOKEN_URL =
  'https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire';
const SEARCH_URL =
  'https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search';

// L'API France Travail limite une recherche à 5 départements max.
// On découpe donc l'IDF (8 départements) en 2 batches.
const IDF_BATCHES = ['75,92,93,94', '77,78,91,95'];

// Limite API : 150 résultats par page, 3000 résultats max par requête.
const PAGE_SIZE = 150;
const MAX_OFFSET = 3000;

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

interface FTSearchResponse {
  resultats?: unknown[];
}

async function getAccessToken(env: Env): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.FRANCE_TRAVAIL_CLIENT_ID,
      client_secret: env.FRANCE_TRAVAIL_CLIENT_SECRET,
      scope: 'api_offresdemploiv2 o2dsoffre',
    }),
  });
  if (!res.ok) {
    throw new Error(
      `OAuth2 France Travail a échoué : ${res.status} ${await res.text()}`,
    );
  }
  const data = (await res.json()) as TokenResponse;
  return data.access_token;
}

async function searchPage(
  token: string,
  departements: string,
  minCreationDate: string,
  start: number,
  end: number,
): Promise<unknown[]> {
  const url = new URL(SEARCH_URL);
  url.searchParams.set('departement', departements);
  url.searchParams.set('minCreationDate', minCreationDate);
  url.searchParams.set('range', `${start}-${end}`);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  if (res.status === 204) return [];
  if (res.status !== 200 && res.status !== 206) {
    throw new Error(
      `Recherche France Travail a échoué : ${res.status} ${await res.text()}`,
    );
  }
  const data = (await res.json()) as FTSearchResponse;
  return data.resultats ?? [];
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    // Contrôle du secret partagé (header X-API-Key).
    const providedKey = req.headers.get('X-API-Key');
    if (!env.SHARED_API_KEY || providedKey !== env.SHARED_API_KEY) {
      return new Response('Unauthorized', { status: 401 });
    }

    const url = new URL(req.url);
    if (req.method !== 'GET' || url.pathname !== '/offres') {
      return new Response('Not found', { status: 404 });
    }

    const minCreationDate = url.searchParams.get('minCreationDate');
    if (!minCreationDate) {
      return new Response('Missing minCreationDate query param', {
        status: 400,
      });
    }

    try {
      const token = await getAccessToken(env);
      const offres: unknown[] = [];
      // Pour chaque batch de départements, pagination 0-149, 150-299, ...
      for (const batch of IDF_BATCHES) {
        for (let start = 0; start + PAGE_SIZE <= MAX_OFFSET; start += PAGE_SIZE) {
          const end = start + PAGE_SIZE - 1;
          const page = await searchPage(token, batch, minCreationDate, start, end);
          offres.push(...page);
          if (page.length < PAGE_SIZE) break;
        }
      }
      return Response.json({ offres, count: offres.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return new Response(msg, { status: 502 });
    }
  },
} satisfies ExportedHandler<Env>;
