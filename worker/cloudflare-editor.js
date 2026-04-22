// ============================================================================
// Version JS sans types — à copier-coller dans l'éditeur Cloudflare Workers.
// Source de vérité TypeScript : worker/src/index.ts
//
// Secrets requis sur le Worker :
//   - FRANCE_TRAVAIL_CLIENT_ID
//   - FRANCE_TRAVAIL_CLIENT_SECRET
//   - SHARED_API_KEY       : clé partagée header X-API-Key
//   - GITHUB_KEY           : PAT fine-grained, Contents R/W sur Bapt252/leads
//   - GITHUB_REPO          : "Bapt252/leads"
//
// Endpoints :
//   - GET   /offres                         proxy France Travail
//   - PATCH /leads/:id                      modif user d'une offre
//   - POST  /leads/mark-all-prospected      bascule en masse { ids: string[] }
//   - POST  /ingest/france-travail          workflow_dispatch de enrich.yml
// ============================================================================

// ----------------------------------------------------------------------------
// Partie France Travail (inchangée).
// ----------------------------------------------------------------------------

const TOKEN_URL =
  'https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire';
const SEARCH_URL =
  'https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search';

// L'API France Travail limite une recherche à 5 départements max.
const IDF_BATCHES = ['75,92,93,94', '77,78,91,95'];

const PAGE_SIZE = 150;
const MAX_OFFSET = 3000;

async function getAccessToken(env) {
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
    throw new Error(`OAuth2 France Travail a échoué : ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.access_token;
}

async function searchPage(token, departements, minCreationDate, maxCreationDate, start, end) {
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
    throw new Error(`Recherche France Travail a échoué : ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.resultats ?? [];
}

async function handleOffres(req, env) {
  const url = new URL(req.url);
  const minCreationDate = url.searchParams.get('minCreationDate');
  if (!minCreationDate) {
    return new Response('Missing minCreationDate query param', { status: 400 });
  }
  const maxCreationDate = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  const token = await getAccessToken(env);
  const offres = [];
  for (const batch of IDF_BATCHES) {
    for (let start = 0; start + PAGE_SIZE <= MAX_OFFSET; start += PAGE_SIZE) {
      const end = start + PAGE_SIZE - 1;
      const page = await searchPage(token, batch, minCreationDate, maxCreationDate, start, end);
      offres.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
  }
  return Response.json({ offres, count: offres.length });
}

// ----------------------------------------------------------------------------
// Partie GitHub (nouveau).
// ----------------------------------------------------------------------------

const LEADS_PATH = 'public/data/leads.json';
const ENRICH_WORKFLOW = 'enrich.yml';

function ghHeaders(env) {
  const h = new Headers();
  h.set('Authorization', `Bearer ${env.GITHUB_KEY}`);
  h.set('Accept', 'application/vnd.github+json');
  h.set('X-GitHub-Api-Version', '2022-11-28');
  h.set('User-Agent', 'leads-worker');
  return h;
}

// Encode UTF-8 → base64 (btoa ne gère pas l'UTF-8 brut).
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function getLeadsFile(env) {
  const res = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${LEADS_PATH}`,
    { headers: ghHeaders(env) },
  );
  if (!res.ok) {
    throw new Error(`GET leads.json a échoué : ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  if (data.encoding !== 'base64') {
    throw new Error(`Encodage GitHub inattendu : ${data.encoding}`);
  }
  const json = atob(data.content.replace(/\n/g, ''));
  return { store: JSON.parse(json), sha: data.sha };
}

async function putLeadsFile(env, store, sha, message) {
  const content = JSON.stringify(store, null, 2) + '\n';
  const res = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${LEADS_PATH}`,
    {
      method: 'PUT',
      headers: ghHeaders(env),
      body: JSON.stringify({ message, content: toBase64(content), sha }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`PUT leads.json a échoué : ${res.status} ${body}`);
    err.status = res.status;
    throw err;
  }
}

async function dispatchEnrich(env) {
  const res = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${ENRICH_WORKFLOW}/dispatches`,
    {
      method: 'POST',
      headers: ghHeaders(env),
      body: JSON.stringify({ ref: 'main' }),
    },
  );
  if (!res.ok) {
    throw new Error(`workflow_dispatch a échoué : ${res.status} ${await res.text()}`);
  }
}

// Normalise un champ texte : trim, '' → null.
function normStr(v) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? null : t;
}

function parsePatch(body) {
  if (typeof body !== 'object' || body === null) return null;
  const patch = {};
  if (body.status !== undefined) {
    if (body.status !== 'new' && body.status !== 'prospected') return null;
    patch.status = body.status;
  }
  for (const key of ['contact_name', 'contact_email', 'contact_phone', 'notes']) {
    if (body[key] !== undefined) {
      const v = normStr(body[key]);
      if (v === undefined) return null;
      patch[key] = v;
    }
  }
  return patch;
}

function applyPatch(job, patch) {
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
async function mutateLeads(env, message, mutate) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { store, sha } = await getLeadsFile(env);
    const result = mutate(store);
    if (!result.ok) return result.response;
    store.updated_at = new Date().toISOString();
    try {
      await putLeadsFile(env, store, sha, message);
      return Response.json({ ok: true });
    } catch (err) {
      if (err.status === 409 && attempt === 0) continue;
      throw err;
    }
  }
  return new Response('Conflit GitHub persistant', { status: 409 });
}

async function handlePatchLead(req, env, leadId) {
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

async function handleMarkAllProspected(req, env) {
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.ids) || body.ids.some((i) => typeof i !== 'string')) {
    return new Response('Body attendu : { ids: string[] }', { status: 400 });
  }
  const ids = new Set(body.ids);
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

async function handleIngestFT(env) {
  await dispatchEnrich(env);
  return Response.json({ ok: true, message: 'Workflow enrich déclenché' });
}

// ----------------------------------------------------------------------------
// Routeur.
// ----------------------------------------------------------------------------

export default {
  async fetch(req, env) {
    const providedKey = req.headers.get('X-API-Key');
    if (!env.SHARED_API_KEY || providedKey !== env.SHARED_API_KEY) {
      return new Response('Unauthorized', { status: 401 });
    }

    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    try {
      if (method === 'GET' && path === '/offres') {
        return await handleOffres(req, env);
      }
      if (method === 'POST' && path === '/ingest/france-travail') {
        return await handleIngestFT(env);
      }
      if (method === 'POST' && path === '/leads/mark-all-prospected') {
        return await handleMarkAllProspected(req, env);
      }
      const match = path.match(/^\/leads\/(.+)$/);
      if (method === 'PATCH' && match) {
        return await handlePatchLead(req, env, decodeURIComponent(match[1]));
      }

      return new Response('Not found', { status: 404 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[worker] erreur :', msg);
      return new Response(msg, { status: 502 });
    }
  },
};
