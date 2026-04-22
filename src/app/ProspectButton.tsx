'use client';

import { useRef, useState, type FormEvent } from 'react';
import { patchLead, type Job } from '@/lib/store';

// Bouton par ligne + modal natif <dialog> avec un formulaire contact.
// Le submit appelle le Worker Cloudflare (PATCH /leads/:id), puis demande
// au parent de recharger le store.

interface Props {
  job: Pick<
    Job,
    | 'id'
    | 'status'
    | 'contact_name'
    | 'contact_email'
    | 'contact_phone'
    | 'notes'
    | 'company_name'
    | 'job_title'
  >;
  onUpdated: () => Promise<void>;
}

function emptyToNull(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function ProspectButton({ job, onUpdated }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);

  const isProspected = job.status === 'prospected';
  const buttonLabel = isProspected ? 'Éditer' : 'Prospecter';
  const buttonClass = isProspected
    ? 'inline-flex items-center rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50'
    : 'inline-flex items-center rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-zinc-700';

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    const data = new FormData(e.currentTarget);
    setSaving(true);
    try {
      await patchLead(job.id, {
        status: 'prospected',
        contact_name: emptyToNull(data.get('contact_name')),
        contact_email: emptyToNull(data.get('contact_email')),
        contact_phone: emptyToNull(data.get('contact_phone')),
        notes: emptyToNull(data.get('notes')),
      });
      dialogRef.current?.close();
      await onUpdated();
    } catch (err) {
      window.alert(
        `Échec : ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setSaving(false);
    }
  }

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
        className="rounded-2xl border border-zinc-200 p-0 shadow-2xl backdrop:bg-zinc-900/40 backdrop:backdrop-blur-sm"
      >
        <form onSubmit={handleSubmit} className="flex w-[460px] flex-col p-0">
          <div className="border-b border-zinc-100 px-6 py-5">
            <h2 className="text-lg font-semibold text-zinc-900">
              {isProspected ? 'Mettre à jour le contact' : 'Marquer prospecté'}
            </h2>
            <p className="mt-0.5 text-sm text-zinc-500">
              {job.company_name}{' '}
              <span className="text-zinc-400">·</span> {job.job_title}
            </p>
          </div>

          <div className="flex flex-col gap-4 px-6 py-5">
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

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-zinc-600">Notes</span>
              <textarea
                name="notes"
                defaultValue={job.notes ?? ''}
                rows={3}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
                placeholder="Historique des échanges, intérêt, blocages…"
              />
            </label>
          </div>

          <div className="flex justify-end gap-2 border-t border-zinc-100 bg-zinc-50/50 px-6 py-4">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              disabled={saving}
              className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-700 disabled:opacity-50"
            >
              {saving ? 'Enregistrement…' : 'Enregistrer'}
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
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-zinc-600">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
      />
    </label>
  );
}
