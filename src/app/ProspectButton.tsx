'use client';

import { useRef } from 'react';
import { prospectAction } from './actions';
import type { Job } from '@/lib/db';

// Bouton par ligne + modal natif <dialog> avec un formulaire contact.
// Le formulaire est soumis via Server Action : la modal se ferme
// immédiatement au submit (optimiste), le revalidatePath côté serveur
// rafraîchit la table.

interface Props {
  job: Pick<
    Job,
    'id' | 'status' | 'contact_name' | 'contact_email' | 'contact_phone' | 'notes' | 'company_name' | 'job_title'
  >;
}

export function ProspectButton({ job }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const isProspected = job.status === 'prospected';
  const buttonLabel = isProspected ? 'Éditer' : 'Prospecter';
  const buttonClass = isProspected
    ? 'rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 transition hover:bg-zinc-50'
    : 'rounded-md bg-zinc-900 px-2 py-1 text-xs text-white transition hover:bg-zinc-700';

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className={buttonClass}
      >
        {buttonLabel}
      </button>

      <dialog
        ref={dialogRef}
        className="rounded-lg border border-zinc-200 p-0 shadow-xl backdrop:bg-black/40"
      >
        <form
          action={prospectAction}
          onSubmit={() => dialogRef.current?.close()}
          className="flex w-[420px] flex-col gap-3 p-6"
        >
          <div>
            <h2 className="text-lg font-semibold">
              {isProspected ? 'Mettre à jour' : 'Marquer prospecté'}
            </h2>
            <p className="text-xs text-zinc-500">
              {job.company_name} — {job.job_title}
            </p>
          </div>

          <input type="hidden" name="job_id" value={job.id} />

          <Field
            label="Nom du contact"
            name="contact_name"
            defaultValue={job.contact_name ?? ''}
            placeholder="Jeanne Dupont"
          />
          <Field
            label="Email"
            name="contact_email"
            type="email"
            defaultValue={job.contact_email ?? ''}
            placeholder="jeanne.dupont@exemple.fr"
          />
          <Field
            label="Téléphone"
            name="contact_phone"
            type="tel"
            defaultValue={job.contact_phone ?? ''}
            placeholder="06 12 34 56 78"
          />

          <label className="flex flex-col gap-1">
            <span className="text-sm text-zinc-700">Notes</span>
            <textarea
              name="notes"
              defaultValue={job.notes ?? ''}
              rows={3}
              className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
              placeholder="Historique des échanges, intérêt, blocages…"
            />
          </label>

          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 transition hover:bg-zinc-50"
            >
              Annuler
            </button>
            <button
              type="submit"
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-700"
            >
              Enregistrer
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

function Field({
  label,
  name,
  type = 'text',
  defaultValue,
  placeholder,
}: {
  label: string;
  name: string;
  type?: 'text' | 'email' | 'tel';
  defaultValue: string;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm text-zinc-700">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
      />
    </label>
  );
}
