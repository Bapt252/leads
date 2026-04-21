'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  markAllProspected,
  markProspected,
  type JobFilter,
} from '@/lib/db';
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

// Schéma de validation du formulaire de prospection.
// Les 4 champs sont optionnels ; on normalise les chaînes vides en null.
const prospectSchema = z.object({
  job_id: z.coerce.number().int().positive(),
  contact_name: z.string().trim().max(200).optional(),
  contact_email: z
    .union([z.literal(''), z.string().trim().email().max(200)])
    .optional(),
  contact_phone: z.string().trim().max(50).optional(),
  notes: z.string().trim().max(5000).optional(),
});

function emptyToNull(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

// Marque une offre prospectée en sauvegardant (ou mettant à jour) les
// informations de contact + notes.
export async function prospectAction(formData: FormData): Promise<void> {
  const raw = {
    job_id: formData.get('job_id'),
    contact_name: formData.get('contact_name'),
    contact_email: formData.get('contact_email'),
    contact_phone: formData.get('contact_phone'),
    notes: formData.get('notes'),
  };
  const parsed = prospectSchema.safeParse(raw);
  if (!parsed.success) {
    console.error('[prospect] validation invalide', parsed.error.flatten());
    return;
  }

  markProspected(parsed.data.job_id, {
    contact_name: emptyToNull(parsed.data.contact_name),
    contact_email: emptyToNull(parsed.data.contact_email),
    contact_phone: emptyToNull(parsed.data.contact_phone),
    notes: emptyToNull(parsed.data.notes),
  });
  revalidatePath('/');
}
