import { insertJobs, type NewJob } from '@/lib/db';

export interface IngestResult {
  source: 'france_travail';
  fetched: number;
  inserted: number;
}

// Squelette : à brancher à l'API France Travail (OAuth2 client credentials)
// via FRANCE_TRAVAIL_CLIENT_ID / FRANCE_TRAVAIL_CLIENT_SECRET.
// Pour l'instant retourne 0 — la prochaine session appellera /partenaire/offresdemploi/v2/offres
// avec filtre IDF et mappera la réponse vers NewJob[].
export async function ingestFranceTravail(): Promise<IngestResult> {
  const jobs: NewJob[] = [];
  const inserted = insertJobs(jobs);
  return { source: 'france_travail', fetched: jobs.length, inserted };
}
