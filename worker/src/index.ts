// Worker Cloudflare multi-endpoints :
//   - GET    /offres                        : proxy vers l'API France Travail
//   - GET    /leads                         : lit le store complet (public, pas d'auth)
//   - PATCH  /leads/:id                     : modifie un lead (KV)
//   - DELETE /leads/:id                     : supprime un lead + ajoute aux tombstones
//   - POST   /leads/mark-all-prospected     : bascule en masse plusieurs leads en 'prospected'
//   - POST   /leads/bulk-upsert             : ingère un lot d'offres FT (appelé par enrich.yml)
//   - POST   /ingest/france-travail         : déclenche le workflow GitHub Actions d'enrich
//
// Authentification : X-API-Key (vs SHARED_API_KEY). GET /leads est volontairement public
// pour préserver la compat avec l'ancien fetch direct du fichier statique.
//
// Stockage : namespace KV `LEADS_STORE`, clé unique `store` contenant tout le JSON.

interface Env {
  FRANCE_TRAVAIL_CLIENT_ID: string;
  FRANCE_TRAVAIL_CLIENT_SECRET: string;
  SHARED_API_KEY: string;
  // Toujours utile pour déclencher le workflow GitHub Actions d'enrich (workflow_dispatch).
  GITHUB_KEY: string;
  // KV : tout le store des leads en une seule clé.
  LEADS_STORE: KVNamespace;
}

const GITHUB_REPO = 'Bapt252/leads';
const ENRICH_WORKFLOW = 'enrich.yml';
const STORE_KEY = 'store';

// ----------------------------------------------------------------------------
// Partie France Travail (proxy /offres) — inchangée.
// ----------------------------------------------------------------------------

const TOKEN_URL =
  'https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire';
const SEARCH_URL =
  'https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search';

const IDF_BATCHES = ['75,92,93,94', '77,78,91,95'];
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
// Types domaine.
// ----------------------------------------------------------------------------

type JobStatus = 'new' | 'prospected';

type AccountStage =
  | 'nouveau'
  | 'contacte'
  | 'relance'
  | 'rdv'
  | 'qualifie'
  | 'gagne'
  | 'perdu';

type ActivityKind = 'stage_change' | 'note' | 'contact' | 'system';

interface ActivityEntry {
  at: string;
  kind: ActivityKind;
  message: string;
  stage_from?: AccountStage;
  stage_to?: AccountStage;
}

interface Account {
  id: string;
  company_name: string;
  stage: AccountStage;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  last_contact_at: string | null;
  next_action: string | null;
  next_action_at: string | null;
  activity: ActivityEntry[];
  created_at: string;
  updated_at: string;
}

interface Job {
  id: string;
  source: 'france_travail';
  source_url: string | null;
  company_name: string;
  account_id: string;
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
  version: 2;
  updated_at: string;
  accounts: Account[];
  jobs: Job[];
  // IDs d'offres supprimées par l'utilisateur. Filtrées à l'ingestion pour
  // ne pas faire revenir une offre qu'on a explicitement écartée.
  tombstones: string[];
}

interface LeadPatch {
  status?: JobStatus;
  // Permet de renseigner manuellement une entreprise quand France Travail
  // l'a masquée ("Non communiqué"). Doit être non-vide ; null interdit.
  company_name?: string;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  notes?: string | null;
}

// ----------------------------------------------------------------------------
// Helpers domaine.
// ----------------------------------------------------------------------------

function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function accountIdFor(companyName: string): string {
  const n = normalizeCompanyName(companyName);
  const slug = n.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return slug || 'entreprise-inconnue';
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

// ----------------------------------------------------------------------------
// KV I/O.
// ----------------------------------------------------------------------------

function emptyStore(): LeadsStore {
  return {
    version: 2,
    updated_at: new Date().toISOString(),
    accounts: [],
    jobs: [],
    tombstones: [],
  };
}

async function getStore(env: Env): Promise<LeadsStore> {
  const raw = await env.LEADS_STORE.get(STORE_KEY);
  if (raw === null) return emptyStore();
  const parsed = JSON.parse(raw) as Partial<LeadsStore>;
  // Garde-fou pour stores écrits avant l'ajout du champ tombstones.
  return {
    version: 2,
    updated_at: parsed.updated_at ?? new Date().toISOString(),
    accounts: parsed.accounts ?? [],
    jobs: parsed.jobs ?? [],
    tombstones: parsed.tombstones ?? [],
  };
}

async function putStore(env: Env, store: LeadsStore): Promise<void> {
  store.updated_at = new Date().toISOString();
  await env.LEADS_STORE.put(STORE_KEY, JSON.stringify(store));
}

// Lit le store, applique une mutation, réécrit. KV est atomic per key, donc
// pas de retry/CAS comme avec l'API GitHub Contents : un seul writer suffit.
async function mutateStore(
  env: Env,
  mutate: (store: LeadsStore) => { ok: true } | { ok: false; response: Response },
): Promise<Response> {
  const store = await getStore(env);
  const result = mutate(store);
  if (!result.ok) return result.response;
  await putStore(env, store);
  // On renvoie le store complet pour que le front n'ait pas à refetcher
  // (la lecture KV juste après une écriture peut servir une valeur stale).
  return Response.json({ ok: true, store });
}

// ----------------------------------------------------------------------------
// Validation patch.
// ----------------------------------------------------------------------------

function normStr(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? null : t;
}

function parsePatch(body: unknown): LeadPatch | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  const patch: LeadPatch = {};
  if (b.status !== undefined) {
    if (b.status !== 'new' && b.status !== 'prospected') return null;
    patch.status = b.status;
  }
  if (b.company_name !== undefined) {
    if (typeof b.company_name !== 'string') return null;
    const t = b.company_name.trim();
    if (t === '') return null;
    patch.company_name = t;
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

function applyPatch(store: LeadsStore, job: Job, patch: LeadPatch): void {
  if (patch.status !== undefined) {
    job.status = patch.status;
    if (patch.status === 'prospected' && !job.prospected_at) {
      job.prospected_at = new Date().toISOString();
    }
  }
  if (patch.company_name !== undefined && patch.company_name !== job.company_name) {
    job.company_name = patch.company_name;
    const newAccountId = accountIdFor(patch.company_name);
    job.account_id = newAccountId;
    if (!store.accounts.find((a) => a.id === newAccountId)) {
      const now = new Date().toISOString();
      store.accounts.push({
        id: newAccountId,
        company_name: patch.company_name,
        stage: 'nouveau',
        contact_name: null,
        contact_email: null,
        contact_phone: null,
        notes: null,
        last_contact_at: null,
        next_action: null,
        next_action_at: null,
        activity: [],
        created_at: now,
        updated_at: now,
      });
    }
  }
  if (patch.contact_name !== undefined) job.contact_name = patch.contact_name;
  if (patch.contact_email !== undefined) job.contact_email = patch.contact_email;
  if (patch.contact_phone !== undefined) job.contact_phone = patch.contact_phone;
  if (patch.notes !== undefined) job.notes = patch.notes;
}

// ----------------------------------------------------------------------------
// Handlers leads.
// ----------------------------------------------------------------------------

async function handleGetLeads(env: Env): Promise<Response> {
  const store = await getStore(env);
  return Response.json(store);
}

async function handlePatchLead(
  req: Request,
  env: Env,
  leadId: string,
): Promise<Response> {
  const body = await req.json().catch(() => null);
  const patch = parsePatch(body);
  if (!patch) return new Response('Body invalide', { status: 400 });

  return mutateStore(env, (store) => {
    const job = store.jobs.find((j) => j.id === leadId);
    if (!job) {
      return { ok: false, response: new Response('Lead not found', { status: 404 }) };
    }
    applyPatch(store, job, patch);
    return { ok: true };
  });
}

async function handleDeleteLead(env: Env, leadId: string): Promise<Response> {
  return mutateStore(env, (store) => {
    const idx = store.jobs.findIndex((j) => j.id === leadId);
    if (idx === -1) {
      return { ok: false, response: new Response('Lead not found', { status: 404 }) };
    }
    store.jobs.splice(idx, 1);
    if (!store.tombstones.includes(leadId)) {
      store.tombstones.push(leadId);
    }
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
  if (ids.size === 0) {
    const store = await getStore(env);
    return Response.json({ ok: true, store });
  }

  return mutateStore(env, (store) => {
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

// Ingère un lot d'offres FT brutes : dédoublonne contre tombstones et store
// actuel, ajoute les nouvelles, backfill les champs source nuls des existantes.
async function handleBulkUpsert(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { offres?: unknown } | null;
  if (!body || !Array.isArray(body.offres)) {
    return new Response('Body attendu : { offres: FTOffre[] }', { status: 400 });
  }

  const store = await getStore(env);
  const tombstones = new Set(store.tombstones);
  const byId = new Map(store.jobs.map((j) => [j.id, j]));
  const accountIds = new Set(store.accounts.map((a) => a.id));
  const now = new Date().toISOString();
  let added = 0;
  let touched = 0;
  let skipped = 0;

  for (const offreRaw of body.offres as FTOffre[]) {
    if (
      !offreRaw ||
      typeof offreRaw.id !== 'string' ||
      typeof offreRaw.intitule !== 'string'
    ) {
      continue;
    }
    const id = `ft:${offreRaw.id}`;
    if (tombstones.has(id)) {
      skipped++;
      continue;
    }
    const source = mapOffre(offreRaw);
    const existing = byId.get(id);
    if (existing) {
      existing.departement ??= source.departement;
      existing.sector ??= source.sector;
      existing.rome_label ??= source.rome_label;
      touched++;
    } else {
      const accountId = accountIdFor(source.company_name);
      if (!accountIds.has(accountId)) {
        store.accounts.push({
          id: accountId,
          company_name: source.company_name,
          stage: 'nouveau',
          contact_name: null,
          contact_email: null,
          contact_phone: null,
          notes: null,
          last_contact_at: null,
          next_action: null,
          next_action_at: null,
          activity: [],
          created_at: now,
          updated_at: now,
        });
        accountIds.add(accountId);
      }
      const job: Job = {
        ...source,
        account_id: accountId,
        status: 'new',
        contact_name: null,
        contact_email: null,
        contact_phone: null,
        notes: null,
        prospected_at: null,
        created_at: now,
      };
      store.jobs.push(job);
      byId.set(id, job);
      added++;
    }
  }

  await putStore(env, store);
  return Response.json({
    ok: true,
    added,
    touched,
    skipped,
    total: store.jobs.length,
  });
}

async function handleIngestFT(env: Env): Promise<Response> {
  await dispatchEnrich(env);
  return Response.json({ ok: true, message: 'Workflow enrich déclenché' });
}

// ----------------------------------------------------------------------------
// GitHub Actions workflow_dispatch (pour le bouton "Ingérer maintenant").
// ----------------------------------------------------------------------------

function ghHeaders(env: Env): Headers {
  const h = new Headers();
  h.set('Authorization', `Bearer ${env.GITHUB_KEY}`);
  h.set('Accept', 'application/vnd.github+json');
  h.set('X-GitHub-Api-Version', '2022-11-28');
  h.set('User-Agent', 'leads-worker');
  return h;
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

// ----------------------------------------------------------------------------
// Routeur.
// ----------------------------------------------------------------------------

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
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
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    try {
      // Endpoint public (lecture seule) — pas d'auth, pour la compat avec
      // l'ancien fetch direct du fichier statique data/leads.json.
      if (method === 'GET' && path === '/leads') {
        return withCors(await handleGetLeads(env));
      }

      // Auth pour tout le reste.
      const providedKey = req.headers.get('X-API-Key');
      if (!env.SHARED_API_KEY || providedKey !== env.SHARED_API_KEY) {
        return withCors(new Response('Unauthorized', { status: 401 }));
      }

      if (method === 'GET' && path === '/offres') {
        return withCors(await handleOffres(req, env));
      }
      if (method === 'POST' && path === '/ingest/france-travail') {
        return withCors(await handleIngestFT(env));
      }
      if (method === 'POST' && path === '/leads/mark-all-prospected') {
        return withCors(await handleMarkAllProspected(req, env));
      }
      if (method === 'POST' && path === '/leads/bulk-upsert') {
        return withCors(await handleBulkUpsert(req, env));
      }

      const match = path.match(/^\/leads\/(.+)$/);
      if (match) {
        const leadId = decodeURIComponent(match[1]);
        if (method === 'PATCH') {
          return withCors(await handlePatchLead(req, env, leadId));
        }
        if (method === 'DELETE') {
          return withCors(await handleDeleteLead(env, leadId));
        }
      }

      return withCors(new Response('Not found', { status: 404 }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[worker] erreur :', msg);
      return withCors(new Response(msg, { status: 502 }));
    }
  },
} satisfies ExportedHandler<Env>;
