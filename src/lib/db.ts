import Database from 'better-sqlite3';
import path from 'node:path';

// Fichier SQLite à la racine du projet (gitignored).
const DB_PATH = path.join(process.cwd(), 'leads.db');

// On garde la connexion sur globalThis pour survivre au hot-reload de Next.
const globalForDb = globalThis as unknown as { __leadsDb?: Database.Database };

function getDb(): Database.Database {
  if (!globalForDb.__leadsDb) {
    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
    globalForDb.__leadsDb = db;
  }
  return globalForDb.__leadsDb;
}

// Création initiale + migrations idempotentes (ajout de colonnes sur une base existante).
// L'ordre est important : on crée la table, puis on migre les colonnes manquantes,
// PUIS seulement on crée les index (sinon un index sur une colonne ajoutée par
// migration échouerait car SQLite parse le bloc exec en une fois).
function initSchema(db: Database.Database): void {
  // 1. Table de base.
  db.exec(`
    create table if not exists jobs (
      id             integer primary key autoincrement,
      source         text    not null check (source in ('france_travail','indeed','linkedin')),
      source_url     text,
      company_name   text    not null,
      job_title      text    not null,
      location       text,
      posted_at      text,
      status         text    not null default 'new' check (status in ('new','prospected')),
      created_at     text    not null default (datetime('now')),
      departement    text,
      sector         text,
      rome_label     text,
      contact_name   text,
      contact_email  text,
      contact_phone  text,
      notes          text,
      prospected_at  text
    );
  `);

  // 2. Migration pour bases créées avant ces colonnes.
  // SQLite n'ayant pas `alter table ... add column if not exists`, on détecte via PRAGMA.
  const existing = new Set(
    (db.pragma('table_info(jobs)') as Array<{ name: string }>).map((c) => c.name),
  );
  const newColumns: Array<[string, string]> = [
    ['departement', 'text'],
    ['sector', 'text'],
    ['rome_label', 'text'],
    ['contact_name', 'text'],
    ['contact_email', 'text'],
    ['contact_phone', 'text'],
    ['notes', 'text'],
    ['prospected_at', 'text'],
  ];
  for (const [name, type] of newColumns) {
    if (!existing.has(name)) {
      db.exec(`alter table jobs add column ${name} ${type}`);
    }
  }

  // 3. Index (à créer après les ALTER pour que les colonnes cibles existent).
  db.exec(`
    create index if not exists idx_jobs_status
      on jobs (status, posted_at desc);
    create index if not exists idx_jobs_departement on jobs (departement);
    create index if not exists idx_jobs_sector      on jobs (sector);
    create index if not exists idx_jobs_rome        on jobs (rome_label);

    -- Déduplication : une même offre d'une même source ne doit rentrer qu'une fois.
    create unique index if not exists uq_jobs_source_url
      on jobs (source, source_url)
      where source_url is not null;
  `);
}

export type JobSource = 'france_travail' | 'indeed' | 'linkedin';
export type JobStatus = 'new' | 'prospected';
export type JobFilter = 'new' | 'prospected' | 'all';

export interface Job {
  id: number;
  source: JobSource;
  source_url: string | null;
  company_name: string;
  job_title: string;
  location: string | null;
  posted_at: string | null;
  status: JobStatus;
  created_at: string;
  departement: string | null;
  sector: string | null;
  rome_label: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  prospected_at: string | null;
}

export interface ProspectInput {
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
}

export interface NewJob {
  source: JobSource;
  source_url?: string | null;
  company_name: string;
  job_title: string;
  location?: string | null;
  posted_at?: string | null;
  departement?: string | null;
  sector?: string | null;
  rome_label?: string | null;
}

export interface JobQuery {
  status: JobFilter;
  departement?: string;
  sector?: string;
  rome_label?: string;
}

// Liste les offres filtrées, triées des plus récentes aux plus anciennes.
export function getJobs(query: JobQuery): Job[] {
  const db = getDb();
  const where: string[] = [];
  const params: unknown[] = [];

  if (query.status !== 'all') {
    where.push('status = ?');
    params.push(query.status);
  }
  if (query.departement) {
    where.push('departement = ?');
    params.push(query.departement);
  }
  if (query.sector) {
    where.push('sector = ?');
    params.push(query.sector);
  }
  if (query.rome_label) {
    where.push('rome_label = ?');
    params.push(query.rome_label);
  }

  const whereSql = where.length > 0 ? `where ${where.join(' and ')}` : '';
  const sql = `select * from jobs ${whereSql} order by coalesce(posted_at, created_at) desc`;
  return db.prepare(sql).all(...params) as Job[];
}

// Bascule toutes les offres "new" en "prospected" dans une seule transaction.
// Retourne le nombre de lignes impactées.
export function markAllProspected(filter: JobFilter): number {
  // Sur le filtre "prospected", rien à faire.
  if (filter === 'prospected') return 0;
  const db = getDb();
  const info = db
    .prepare(
      "update jobs set status = 'prospected', prospected_at = coalesce(prospected_at, datetime('now')) where status = 'new'",
    )
    .run();
  return info.changes;
}

// Marque une offre individuelle comme prospectée et enregistre les infos contact.
// Idempotent : peut être appelé sur une offre déjà prospectée pour mettre à jour
// les contacts/notes. Le prospected_at n'est fixé qu'à la première bascule.
export function markProspected(jobId: number, input: ProspectInput): void {
  const db = getDb();
  db.prepare(
    `update jobs
     set status         = 'prospected',
         contact_name   = :contact_name,
         contact_email  = :contact_email,
         contact_phone  = :contact_phone,
         notes          = :notes,
         prospected_at  = coalesce(prospected_at, datetime('now'))
     where id = :id`,
  ).run({
    id: jobId,
    contact_name: input.contact_name,
    contact_email: input.contact_email,
    contact_phone: input.contact_phone,
    notes: input.notes,
  });
}

// Insertion en masse avec déduplication (source, source_url).
// Sur conflit, on backfill uniquement les 3 champs qui peuvent être NULL sur
// d'anciennes lignes (departement, sector, rome_label) — on ne touche ni au
// statut, ni aux contacts, ni aux notes pour ne pas écraser le travail
// manuel de l'utilisateur.
// Retourne le nombre de lignes impactées (insérées ou backfillées).
export function insertJobs(jobs: NewJob[]): number {
  if (jobs.length === 0) return 0;
  const db = getDb();
  const stmt = db.prepare(`
    insert into jobs
      (source, source_url, company_name, job_title, location, posted_at,
       departement, sector, rome_label)
    values
      (@source, @source_url, @company_name, @job_title, @location, @posted_at,
       @departement, @sector, @rome_label)
    on conflict(source, source_url) where source_url is not null do update set
      departement = coalesce(jobs.departement, excluded.departement),
      sector      = coalesce(jobs.sector,      excluded.sector),
      rome_label  = coalesce(jobs.rome_label,  excluded.rome_label)
  `);
  const insertMany = db.transaction((items: NewJob[]): number => {
    let inserted = 0;
    for (const j of items) {
      const info = stmt.run({
        source: j.source,
        source_url: j.source_url ?? null,
        company_name: j.company_name,
        job_title: j.job_title,
        location: j.location ?? null,
        posted_at: j.posted_at ?? null,
        departement: j.departement ?? null,
        sector: j.sector ?? null,
        rome_label: j.rome_label ?? null,
      });
      inserted += info.changes;
    }
    return inserted;
  });
  return insertMany(jobs);
}

// Liste les valeurs distinctes d'une colonne pour alimenter les dropdowns de filtre.
// La colonne est whitelistée au type (pas d'injection possible).
export function getDistinctValues(
  column: 'departement' | 'sector' | 'rome_label',
): string[] {
  const db = getDb();
  const rows = db
    .prepare(
      `select distinct ${column} as v from jobs where ${column} is not null and ${column} != '' order by ${column}`,
    )
    .all() as Array<{ v: string }>;
  return rows.map((r) => r.v);
}
