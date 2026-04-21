'use server';

import { revalidatePath } from 'next/cache';
import { markAllProspected, type JobFilter } from '@/lib/db';
import { ingestFranceTravail } from '@/lib/ingest/france-travail';
import { ingestIndeed } from '@/lib/ingest/indeed';
import { ingestLinkedin } from '@/lib/ingest/linkedin';

// Bascule toutes les offres visibles du filtre courant en "prospected".
export async function markAllProspectedAction(filter: JobFilter): Promise<void> {
  markAllProspected(filter);
  revalidatePath('/');
}

// Lance les 3 ingestions en parallèle et rafraîchit la page.
export async function ingestAllAction(): Promise<void> {
  await Promise.allSettled([
    ingestFranceTravail(),
    ingestIndeed(),
    ingestLinkedin(),
  ]);
  revalidatePath('/');
}
