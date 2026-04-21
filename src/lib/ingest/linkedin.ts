import { insertJobs, type NewJob } from '@/lib/db';

export interface IngestResult {
  source: 'linkedin';
  fetched: number;
  inserted: number;
}

// Squelette : LinkedIn n'a pas d'API publique pour les offres.
// À la prochaine session, choisir l'approche (scraping session cookie, API tierce...).
export async function ingestLinkedin(): Promise<IngestResult> {
  const jobs: NewJob[] = [];
  const inserted = insertJobs(jobs);
  return { source: 'linkedin', fetched: jobs.length, inserted };
}
