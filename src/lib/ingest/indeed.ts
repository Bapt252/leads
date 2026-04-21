import { insertJobs, type NewJob } from '@/lib/db';

export interface IngestResult {
  source: 'indeed';
  fetched: number;
  inserted: number;
}

// Squelette : Indeed n'a pas d'API publique officielle pour la recherche d'offres.
// À la prochaine session, choisir entre scraping direct, SerpAPI, ou flux RSS si dispo.
export async function ingestIndeed(): Promise<IngestResult> {
  const jobs: NewJob[] = [];
  const inserted = insertJobs(jobs);
  return { source: 'indeed', fetched: jobs.length, inserted };
}
