// Migration one-shot v1 → v2 du store leads.
// v1 : { version: 1, jobs: [...] } — jobs sans account_id.
// v2 : { version: 2, accounts: [...], jobs: [...account_id] }.
//
// Stratégie Account (choix A : dédup sur company_name normalisé) :
//   - stage initial = 'nouveau' ; 'contacte' si au moins une offre prospected.
//   - activity[] : entrée 'stage_change' auto-loggée uniquement si promotion nouveau→contacte.
//   - company_name canonique = celui du 1er job rencontré (ordre d'insertion v1).
//   - contact_*, notes : fusionnés depuis le 1er job qui les a.
//   - last_contact_at = max(prospected_at) parmi les jobs de l'account.
//   - created_at = min(created_at) des jobs de l'account.
//
// Script idempotent : si le fichier est déjà en v2, on log et on sort 0.

import { readFile, writeFile } from 'node:fs/promises';

const LEADS_PATH = 'data/leads.json';

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

interface JobV1 {
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

interface JobV2 extends JobV1 {
  account_id: string;
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

interface StoreV1 {
  version: 1;
  updated_at: string;
  jobs: JobV1[];
}

interface StoreV2 {
  version: 2;
  updated_at: string;
  accounts: Account[];
  jobs: JobV2[];
}

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

function migrate(v1: StoreV1): StoreV2 {
  const now = new Date().toISOString();
  const accountsById = new Map<string, Account>();
  const migratedJobs: JobV2[] = [];

  for (const job of v1.jobs) {
    const accountId = accountIdFor(job.company_name);
    migratedJobs.push({ ...job, account_id: accountId });

    const existing = accountsById.get(accountId);
    if (!existing) {
      const stage: AccountStage = job.status === 'prospected' ? 'contacte' : 'nouveau';
      const activity: ActivityEntry[] = [];
      if (stage === 'contacte') {
        activity.push({
          at: job.prospected_at ?? now,
          kind: 'stage_change',
          message: 'Migration v1→v2 : offre déjà prospectée',
          stage_from: 'nouveau',
          stage_to: 'contacte',
        });
      }
      accountsById.set(accountId, {
        id: accountId,
        company_name: job.company_name,
        stage,
        contact_name: job.contact_name,
        contact_email: job.contact_email,
        contact_phone: job.contact_phone,
        notes: job.notes,
        last_contact_at: job.prospected_at,
        next_action: null,
        next_action_at: null,
        activity,
        created_at: job.created_at,
        updated_at: now,
      });
      continue;
    }

    // Promotion de stage si un job est prospected et l'account encore nouveau.
    if (job.status === 'prospected' && existing.stage === 'nouveau') {
      existing.stage = 'contacte';
      existing.activity.push({
        at: job.prospected_at ?? now,
        kind: 'stage_change',
        message: 'Migration v1→v2 : offre déjà prospectée',
        stage_from: 'nouveau',
        stage_to: 'contacte',
      });
    }
    // created_at = min, last_contact_at = max.
    if (job.created_at < existing.created_at) existing.created_at = job.created_at;
    if (
      job.prospected_at &&
      (!existing.last_contact_at || job.prospected_at > existing.last_contact_at)
    ) {
      existing.last_contact_at = job.prospected_at;
    }
    // Backfill contact_* / notes si vides sur l'account.
    existing.contact_name ??= job.contact_name;
    existing.contact_email ??= job.contact_email;
    existing.contact_phone ??= job.contact_phone;
    existing.notes ??= job.notes;
  }

  return {
    version: 2,
    updated_at: now,
    accounts: Array.from(accountsById.values()),
    jobs: migratedJobs,
  };
}

async function main(): Promise<void> {
  const raw = await readFile(LEADS_PATH, 'utf-8');
  const parsed = JSON.parse(raw) as { version: number };

  if (parsed.version === 2) {
    console.log('[migrate] déjà en v2, rien à faire');
    return;
  }
  if (parsed.version !== 1) {
    throw new Error(`[migrate] version inattendue : ${parsed.version}`);
  }

  const v2 = migrate(parsed as unknown as StoreV1);
  await writeFile(LEADS_PATH, JSON.stringify(v2, null, 2) + '\n', 'utf-8');
  console.log(
    `[migrate] v1→v2 OK : ${v2.jobs.length} jobs, ${v2.accounts.length} accounts créés`,
  );
}

main().catch((err) => {
  console.error('[migrate] erreur :', err);
  process.exit(1);
});
