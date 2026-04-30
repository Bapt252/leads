// Script d'enrichissement exécuté par GitHub Actions (cron quotidien + dispatch manuel).
// Récupère les offres FT du jour via le Worker, les pousse au Worker /leads/bulk-upsert
// qui dédoublonne contre tombstones et store actuel et écrit dans KV.
// Plus aucune écriture de fichier ; le store de leads vit désormais dans Cloudflare KV.

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

interface OffresResponse {
  offres: FTOffre[];
  count: number;
}

interface BulkUpsertResponse {
  ok: boolean;
  added: number;
  touched: number;
  skipped: number;
  total: number;
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

async function main(): Promise<void> {
  // Une seule URL/clé : le Worker qui sert à la fois /offres (proxy FT) et
  // /leads/bulk-upsert (écriture KV). On garde les noms historiques pour
  // ne pas casser les secrets existants du repo.
  const workerUrl = requireEnv('FRANCE_TRAVAIL_WORKER_URL').replace(/\/$/, '');
  const workerKey = requireEnv('FRANCE_TRAVAIL_WORKER_KEY');

  const minDate = startOfTodayParisIso();
  console.log(`[enrich] appel Worker FT (offres depuis ${minDate})`);

  const ftRes = await fetch(
    `${workerUrl}/offres?minCreationDate=${encodeURIComponent(minDate)}`,
    { headers: { 'X-API-Key': workerKey } },
  );
  if (!ftRes.ok) {
    throw new Error(`Worker FT a répondu ${ftRes.status} : ${await ftRes.text()}`);
  }
  const { offres, count } = (await ftRes.json()) as OffresResponse;
  console.log(`[enrich] ${count} offres reçues, envoi au Worker /leads/bulk-upsert`);

  const upRes = await fetch(`${workerUrl}/leads/bulk-upsert`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': workerKey,
    },
    body: JSON.stringify({ offres }),
  });
  if (!upRes.ok) {
    throw new Error(`bulk-upsert a échoué : ${upRes.status} ${await upRes.text()}`);
  }
  const r = (await upRes.json()) as BulkUpsertResponse;
  console.log(
    `[enrich] +${r.added} nouvelles, ${r.touched} revues, ${r.skipped} ignorées (tombstones), total ${r.total}`,
  );
}

main().catch((err) => {
  console.error('[enrich] erreur fatale :', err);
  process.exit(1);
});
