// Couche data côté client (navigateur).
// Lectures : fetch direct sur raw.githubusercontent.com (repo public, pas d'auth).
// Écritures : POST/PATCH sur le Worker Cloudflare (auth par header X-API-Key).
//
// La clé API Worker n'est PAS bundlée — l'utilisateur la saisit une fois au
// premier write, elle est stockée dans localStorage. Le site étant public,
// une clé bundlée serait exfiltrable et n'importe qui pourrait spammer le
// Worker ; cette approche "BYO key" est acceptable car l'app est mono-user.

export type JobSource = 'france_travail';
export type JobStatus = 'new' | 'prospected';
export type JobFilter = 'new' | 'prospected' | 'all';

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

export interface LeadPatch {
  status?: JobStatus;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  notes?: string | null;
}

// URL publique du JSON (repo GitHub public, accès anonyme).
// Le cache CDN de raw.githubusercontent.com est ~5 min : les écritures
// apparaissent avec ce délai côté front. Acceptable pour usage perso.
const LEADS_URL =
  'https://raw.githubusercontent.com/Bapt252/leads/main/public/data/leads.json';

// URL du Worker Cloudflare exposée au bundle (non sensible).
const WORKER_URL =
  process.env.NEXT_PUBLIC_WORKER_URL ??
  'https://leads-france-travail.baptiste-coma.workers.dev';

const API_KEY_STORAGE = 'leads.worker_api_key';

export function getApiKey(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(API_KEY_STORAGE);
}

export function setApiKey(key: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(API_KEY_STORAGE, key);
}

export function clearApiKey(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(API_KEY_STORAGE);
}

// Demande interactivement la clé à l'utilisateur si absente. Retourne null
// si l'utilisateur annule.
function ensureApiKey(): string | null {
  const existing = getApiKey();
  if (existing) return existing;
  const entered = window.prompt(
    'Clé API du Worker Cloudflare (une seule fois, stockée localement) :',
  );
  if (!entered) return null;
  setApiKey(entered.trim());
  return entered.trim();
}

// Récupère leads.json public. On ajoute ?t=<timestamp> pour contourner
// le cache navigateur et accélérer les refreshes après une écriture.
export async function loadStore(): Promise<LeadsStore> {
  const res = await fetch(`${LEADS_URL}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`GET leads.json a échoué : ${res.status}`);
  }
  return (await res.json()) as LeadsStore;
}

// Helper interne pour les écritures. Ajoute l'auth, gère 401 (clé fausse).
async function workerFetch(
  path: string,
  init: RequestInit,
): Promise<Response> {
  const key = ensureApiKey();
  if (!key) throw new Error('Clé API absente');
  const res = await fetch(`${WORKER_URL}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      'Content-Type': 'application/json',
      'X-API-Key': key,
    },
  });
  if (res.status === 401) {
    clearApiKey();
    throw new Error('Clé API refusée — retente pour la saisir à nouveau');
  }
  if (!res.ok) {
    throw new Error(`Worker a répondu ${res.status} : ${await res.text()}`);
  }
  return res;
}

export async function patchLead(id: string, patch: LeadPatch): Promise<void> {
  await workerFetch(`/leads/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function markAllProspected(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await workerFetch('/leads/mark-all-prospected', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}

export async function triggerIngest(): Promise<void> {
  await workerFetch('/ingest/france-travail', { method: 'POST' });
}

// Helpers de lecture : filtrage + valeurs distinctes pour les dropdowns.

export interface JobQuery {
  status: JobFilter;
  departement?: string;
  sector?: string;
  rome_label?: string;
}

export function filterJobs(jobs: Job[], query: JobQuery): Job[] {
  return jobs
    .filter((j) => {
      if (query.status !== 'all' && j.status !== query.status) return false;
      if (query.departement && j.departement !== query.departement) return false;
      if (query.sector && j.sector !== query.sector) return false;
      if (query.rome_label && j.rome_label !== query.rome_label) return false;
      return true;
    })
    .sort((a, b) => {
      // Tri desc par posted_at, fallback sur created_at.
      const ka = a.posted_at ?? a.created_at;
      const kb = b.posted_at ?? b.created_at;
      return kb.localeCompare(ka);
    });
}

export function distinctValues(
  jobs: Job[],
  column: 'departement' | 'sector' | 'rome_label',
): string[] {
  const set = new Set<string>();
  for (const j of jobs) {
    const v = j[column];
    if (v) set.add(v);
  }
  return Array.from(set).sort();
}
