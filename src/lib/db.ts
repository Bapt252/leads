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

// Schéma minimal — une seule table, idempotent via `create ... if not exists`.
function initSchema(db: Database.Database): void {
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
      created_at     text    not null default (datetime('now'))
    );

    create index if not exists idx_jobs_status
      on jobs (status, posted_at desc);

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
}

export interface NewJob {
  source: JobSource;
  source_url?: string | null;
  company_name: string;
  job_title: string;
  location?: string | null;
  posted_at?: string | null;
}

// Liste les offres filtrées, triées des plus récentes aux plus anciennes.
export function getJobs(filter: JobFilter): Job[] {
  const db = getDb();
  const orderBy = 'order by coalesce(posted_at, created_at) desc';
  if (filter === 'all') {
    return db.prepare(`select * from jobs ${orderBy}`).all() as Job[];
  }
  return db
    .prepare(`select * from jobs where status = ? ${orderBy}`)
    .all(filter) as Job[];
}

// Bascule toutes les offres "new" en "prospected" dans une seule transaction.
// Retourne le nombre de lignes impactées.
export function markAllProspected(filter: JobFilter): number {
  // Sur le filtre "prospected", rien à faire.
  if (filter === 'prospected') return 0;
  const db = getDb();
  const info = db
    .prepare("update jobs set status = 'prospected' where status = 'new'")
    .run();
  return info.changes;
}

// Insertion en masse avec déduplication (source, source_url).
// Retourne le nombre de nouvelles offres réellement insérées.
export function insertJobs(jobs: NewJob[]): number {
  if (jobs.length === 0) return 0;
  const db = getDb();
  const stmt = db.prepare(`
    insert or ignore into jobs
      (source, source_url, company_name, job_title, location, posted_at)
    values
      (@source, @source_url, @company_name, @job_title, @location, @posted_at)
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
      });
      inserted += info.changes;
    }
    return inserted;
  });
  return insertMany(jobs);
}
