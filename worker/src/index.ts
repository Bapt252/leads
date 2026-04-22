// Worker Cloudflare multi-endpoints :
//   - GET   /offres                         : proxy vers l'API France Travail
//   - PATCH /leads/:id                      : modifie un lead dans leads.json (via API GitHub)
//   - POST  /leads/mark-all-prospected      : bascule en masse plusieurs leads en 'prospected'
//   - POST  /ingest/france-travail          : déclenche le workflow GitHub Actions d'ingestion
//
// Authentification : secret partagé dans le header X-API-Key (vs SHARED_API_KEY).
// Les credentials France Travail + le token GitHub sont des secrets Cloudflare.

interface Env {
  FRANCE_TRAVAIL_CLIENT_ID: string;
  FRANCE_TRAVAIL_CLIENT_SECRET: string;
  SHARED_API_KEY: string;
  GITHUB_KEY: string;
}

// Repo cible hardcodé (pas un secret : c'est une valeur publique).
const GITHUB_REPO = 'Bapt252/leads';

// ----------------------------------------------------------------------------
// Partie France Travail (inchangée).
// ----------------------------------------------------------------------------

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
  maxCreationDate: string,
  start: number,
  end: number,
): Promise<unknown[]> {
  const url = new URL(SEARCH_URL);
  url.searchParams.set('departement', departements);
  url.searchParams.set('minCreationDate', minCreationDate);
  url.searchParams.set('maxCreationDate', maxCreationDate);
  url.searchParams.set('range', `${start}-${end}`);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
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

async function handleOffres(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const minCreationDate = url.searchParams.get('minCreationDate');
  if (!minCreationDate) {
    return new Response('Missing minCreationDate query param', { status: 400 });
  }
  // min + max figé à "maintenant" pour toute l'opération (évite qu'une offre
  // arrivée pendant la pagination ne décale les résultats).
  const maxCreationDate = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  const token = await getAccessToken(env);
  const offres: unknown[] = [];
  for (const batch of IDF_BATCHES) {
    for (let start = 0; start + PAGE_SIZE <= MAX_OFFSET; start += PAGE_SIZE) {
      const end = start + PAGE_SIZE - 1;
      const page = await searchPage(
        token,
        batch,
        minCreationDate,
        maxCreationDate,
        start,
        end,
      );
      offres.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
  }
  return Response.json({ offres, count: offres.length });
}

// ----------------------------------------------------------------------------
// Partie GitHub (nouveau).
// ----------------------------------------------------------------------------

const LEADS_PATH = 'data/leads.json';
const ENRICH_WORKFLOW = 'enrich.yml';

type JobStatus = 'new' | 'prospected';

interface Job {
  id: string;
  source: 'france_travail';
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

interface LeadsStore {
  version: 1;
  updated_at: string;
  jobs: Job[];
}

interface LeadPatch {
  status?: JobStatus;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  notes?: string | null;
}

interface GhContent {
  content: string;
  sha: string;
  encoding: string;
}

function ghHeaders(env: Env): Headers {
  const h = new Headers();
  h.set('Authorization', `Bearer ${env.GITHUB_KEY}`);
  h.set('Accept', 'application/vnd.github+json');
  h.set('X-GitHub-Api-Version', '2022-11-28');
  h.set('User-Agent', 'leads-worker');
  return h;
}

// Encode une string UTF-8 en base64 (btoa ne gère pas l'UTF-8 directement).
function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function getLeadsFile(
  env: Env,
): Promise<{ store: LeadsStore; sha: string }> {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${LEADS_PATH}`,
    { headers: ghHeaders(env) },
  );
  if (!res.ok) {
    throw new Error(`GET leads.json a échoué : ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as GhContent;
  if (data.encoding !== 'base64') {
    throw new Error(`Encodage GitHub inattendu : ${data.encoding}`);
  }
  const json = atob(data.content.replace(/\n/g, ''));
  return { store: JSON.parse(json) as LeadsStore, sha: data.sha };
}

async function putLeadsFile(
  env: Env,
  store: LeadsStore,
  sha: string,
  message: string,
): Promise<void> {
  const content = JSON.stringify(store, null, 2) + '\n';
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${LEADS_PATH}`,
    {
      method: 'PUT',
      headers: ghHeaders(env),
      body: JSON.stringify({ message, content: toBase64(content), sha }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`PUT leads.json a échoué : ${res.status} ${body}`);
    // Marquage du conflit de SHA pour permettre un retry.
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
}

async function dispatchEnrich(env: Env): Promise<void> {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${ENRICH_WORKFLOW}/dispatches`,
    {
      method: 'POST',
      headers: ghHeaders(env),
      body: JSON.stringify({ ref: 'main' }),
    },
  );
  if (!res.ok) {
    throw new Error(
      `workflow_dispatch a échoué : ${res.status} ${await res.text()}`,
    );
  }
}

// Normalise un champ texte : trim, '' → null.
function normStr(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? null : t;
}

// Valide + normalise un body PATCH. Retourne null si invalide.
function parsePatch(body: unknown): LeadPatch | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  const patch: LeadPatch = {};
  if (b.status !== undefined) {
    if (b.status !== 'new' && b.status !== 'prospected') return null;
    patch.status = b.status;
  }
  for (const key of ['contact_name', 'contact_email', 'contact_phone', 'notes'] as const) {
    if (b[key] !== undefined) {
      const v = normStr(b[key]);
      if (v === undefined) return null;
      patch[key] = v;
    }
  }
  return patch;
}

function applyPatch(job: Job, patch: LeadPatch): void {
  if (patch.status !== undefined) {
    job.status = patch.status;
    // prospected_at figé à la première bascule (idempotent ensuite).
    if (patch.status === 'prospected' && !job.prospected_at) {
      job.prospected_at = new Date().toISOString();
    }
  }
  if (patch.contact_name !== undefined) job.contact_name = patch.contact_name;
  if (patch.contact_email !== undefined) job.contact_email = patch.contact_email;
  if (patch.contact_phone !== undefined) job.contact_phone = patch.contact_phone;
  if (patch.notes !== undefined) job.notes = patch.notes;
}

// Lit leads.json, applique une mutation, réécrit. Retry 1x si 409 (race).
async function mutateLeads(
  env: Env,
  message: string,
  mutate: (store: LeadsStore) => { ok: true } | { ok: false; response: Response },
): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { store, sha } = await getLeadsFile(env);
    const result = mutate(store);
    if (!result.ok) return result.response;
    store.updated_at = new Date().toISOString();
    try {
      await putLeadsFile(env, store, sha, message);
      return Response.json({ ok: true });
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status === 409 && attempt === 0) continue;
      throw err;
    }
  }
  return new Response('Conflit GitHub persistant', { status: 409 });
}

async function handlePatchLead(
  req: Request,
  env: Env,
  leadId: string,
): Promise<Response> {
  const body = await req.json().catch(() => null);
  const patch = parsePatch(body);
  if (!patch) return new Response('Body invalide', { status: 400 });

  return mutateLeads(env, `chore(leads): modif ${leadId}`, (store) => {
    const job = store.jobs.find((j) => j.id === leadId);
    if (!job) {
      return { ok: false, response: new Response('Lead not found', { status: 404 }) };
    }
    applyPatch(job, patch);
    return { ok: true };
  });
}

async function handleMarkAllProspected(
  req: Request,
  env: Env,
): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  if (!body || !Array.isArray(body.ids) || body.ids.some((i) => typeof i !== 'string')) {
    return new Response('Body attendu : { ids: string[] }', { status: 400 });
  }
  const ids = new Set(body.ids as string[]);
  if (ids.size === 0) return Response.json({ ok: true, updated: 0 });

  return mutateLeads(env, `chore(leads): prospected x${ids.size}`, (store) => {
    const now = new Date().toISOString();
    for (const j of store.jobs) {
      if (ids.has(j.id) && j.status === 'new') {
        j.status = 'prospected';
        j.prospected_at ??= now;
      }
    }
    return { ok: true };
  });
}

async function handleIngestFT(env: Env): Promise<Response> {
  await dispatchEnrich(env);
  return Response.json({ ok: true, message: 'Workflow enrich déclenché' });
}

// Endpoint de diagnostic : teste le GITHUB_KEY en appelant /user +
// liste les noms (sans valeurs) de tous les bindings env disponibles.
async function handleDebugGithub(env: Env): Promise<Response> {
  const envKeys = Object.keys(env as unknown as Record<string, unknown>).sort();
  const key = env.GITHUB_KEY;
  if (!key) {
    return Response.json({
      ok: false,
      error: 'GITHUB_KEY absent dans env du Worker',
      bindings_visibles_par_le_worker: envKeys,
    });
  }
  const res = await fetch('https://api.github.com/user', {
    headers: ghHeaders(env),
  });
  const body = await res.text();
  return Response.json({
    bindings_visibles_par_le_worker: envKeys,
    token_length: key.length,
    token_prefix: key.slice(0, 4),
    token_has_whitespace: /\s/.test(key),
    github_status: res.status,
    github_response: body.slice(0, 500),
  });
}

// ----------------------------------------------------------------------------
// Routeur.
// ----------------------------------------------------------------------------

// Headers CORS appliqués à toutes les réponses.
// On autorise toute origine : la vraie protection est le header X-API-Key,
// et ce Worker est lui-même destiné à être appelé depuis un front public.
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
  'Access-Control-Max-Age': '86400',
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    // Preflight CORS : le browser envoie OPTIONS avant tout PATCH/POST avec
    // custom header (ici X-API-Key). On répond avant l'auth pour ne pas
    // renvoyer 401 sur un preflight (ce qui bloquerait la vraie requête).
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Auth via secret partagé.
    const providedKey = req.headers.get('X-API-Key');
    if (!env.SHARED_API_KEY || providedKey !== env.SHARED_API_KEY) {
      return withCors(new Response('Unauthorized', { status: 401 }));
    }

    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    try {
      // GET /offres — proxy France Travail (inchangé).
      if (method === 'GET' && path === '/offres') {
        return withCors(await handleOffres(req, env));
      }

      // POST /ingest/france-travail — déclenche l'ingestion manuelle.
      if (method === 'POST' && path === '/ingest/france-travail') {
        return withCors(await handleIngestFT(env));
      }

      // GET /debug/github — diagnostic du GITHUB_KEY.
      if (method === 'GET' && path === '/debug/github') {
        return withCors(await handleDebugGithub(env));
      }

      // POST /leads/mark-all-prospected — bascule en masse.
      if (method === 'POST' && path === '/leads/mark-all-prospected') {
        return withCors(await handleMarkAllProspected(req, env));
      }

      // PATCH /leads/:id — modifie un lead.
      const match = path.match(/^\/leads\/(.+)$/);
      if (method === 'PATCH' && match) {
        return withCors(await handlePatchLead(req, env, decodeURIComponent(match[1])));
      }

      return withCors(new Response('Not found', { status: 404 }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[worker] erreur :', msg);
      return withCors(new Response(msg, { status: 502 }));
    }
  },
} satisfies ExportedHandler<Env>;
