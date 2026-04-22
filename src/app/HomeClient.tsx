'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  distinctValues,
  filterJobs,
  loadStore,
  markAllProspected,
  triggerIngest,
  type Job,
  type JobFilter,
  type LeadsStore,
} from '@/lib/store';
import { jobsToCsv } from '@/lib/csv';
import { FiltersBar } from './FiltersBar';
import { ProspectButton } from './ProspectButton';

const SOURCE_LABEL: Record<Job['source'], string> = {
  france_travail: 'France Travail',
};

function parseStatus(raw: string | null): JobFilter {
  if (raw === 'prospected' || raw === 'all') return raw;
  return 'new';
}

function asString(raw: string | null): string | undefined {
  return raw && raw !== '' ? raw : undefined;
}

export function HomeClient() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [store, setStore] = useState<LeadsStore | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind: 'info' | 'error' } | null>(null);

  const status = parseStatus(searchParams.get('status'));
  const departement = asString(searchParams.get('departement'));
  const sector = asString(searchParams.get('sector'));
  const rome_label = asString(searchParams.get('rome_label'));

  const reload = useCallback(async () => {
    try {
      const s = await loadStore();
      setStore(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    // Chargement initial : les setState sont tous après await, donc async.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  if (!store && error) {
    return <ErrorState message={error} />;
  }
  if (!store) {
    return <LoadingState />;
  }

  const jobs = filterJobs(store.jobs, { status, departement, sector, rome_label });
  const departements = distinctValues(store.jobs, 'departement');
  const sectors = distinctValues(store.jobs, 'sector');
  const romeLabels = distinctValues(store.jobs, 'rome_label');

  // Stats globales (pas filtrées) pour les cartes KPI.
  const statsTotal = store.jobs.length;
  const statsNew = store.jobs.filter((j) => j.status === 'new').length;
  const statsProspected = store.jobs.filter((j) => j.status === 'prospected').length;

  const newCountInView =
    status === 'prospected' ? 0 : jobs.filter((j) => j.status === 'new').length;

  const statusLinkBase = new URLSearchParams();
  if (departement) statusLinkBase.set('departement', departement);
  if (sector) statusLinkBase.set('sector', sector);
  if (rome_label) statusLinkBase.set('rome_label', rome_label);

  async function handleIngest() {
    try {
      await triggerIngest();
      setToast({
        msg: 'Ingestion lancée. Le workflow prend ~1-2 min — rafraîchis dans un instant.',
        kind: 'info',
      });
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : String(e), kind: 'error' });
    }
  }

  async function handleMarkAllProspected() {
    const ids = jobs.filter((j) => j.status === 'new').map((j) => j.id);
    if (ids.length === 0) return;
    try {
      await markAllProspected(ids);
      setToast({ msg: `${ids.length} offre(s) basculée(s) en prospected.`, kind: 'info' });
      await reload();
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : String(e), kind: 'error' });
    }
  }

  function handleExportCsv() {
    const csv = jobsToCsv(jobs);
    const today = new Date().toISOString().slice(0, 10);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leads-${status}-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-white">
      <header className="border-b border-zinc-200 bg-white/70 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-900 text-white">
              <BriefcaseIcon />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-zinc-900">Leads</h1>
              <p className="text-xs text-zinc-500">Prospection B2B — Tenex</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void reload()}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 hover:shadow"
            >
              <RefreshIcon />
              Rafraîchir
            </button>
            <button
              type="button"
              onClick={() => void handleIngest()}
              className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-700"
            >
              <DownloadCloudIcon />
              Ingérer maintenant
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {toast && (
          <Toast
            kind={toast.kind}
            message={toast.msg}
            onClose={() => setToast(null)}
          />
        )}

        <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Total offres" value={statsTotal} accent="zinc" />
          <StatCard label="À prospecter" value={statsNew} accent="blue" />
          <StatCard label="Prospectés" value={statsProspected} accent="green" />
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-100 px-6 py-4">
            <nav className="flex gap-1 rounded-lg bg-zinc-100 p-1 text-sm">
              <StatusTab
                label="À prospecter"
                value="new"
                current={status}
                preserved={statusLinkBase}
                pathname={pathname}
              />
              <StatusTab
                label="Prospectés"
                value="prospected"
                current={status}
                preserved={statusLinkBase}
                pathname={pathname}
              />
              <StatusTab
                label="Toutes"
                value="all"
                current={status}
                preserved={statusLinkBase}
                pathname={pathname}
              />
            </nav>

            <div className="flex gap-2">
              {newCountInView > 0 && (
                <button
                  type="button"
                  onClick={() => void handleMarkAllProspected()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 transition hover:bg-zinc-50"
                >
                  <CheckIcon />
                  Tout marquer ({newCountInView})
                </button>
              )}
              <button
                type="button"
                onClick={handleExportCsv}
                disabled={jobs.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <DocumentIcon />
                Export CSV
              </button>
            </div>
          </div>

          <div className="border-b border-zinc-100 px-6 py-3">
            <FiltersBar
              departements={departements}
              sectors={sectors}
              romeLabels={romeLabels}
              current={{ departement, sector, rome_label }}
            />
          </div>

          {jobs.length === 0 ? (
            <EmptyState />
          ) : (
            <JobsTable jobs={jobs} onUpdated={reload} />
          )}
        </section>

        <footer className="mt-6 flex items-center justify-between text-xs text-zinc-400">
          <span>
            Dernière màj : {new Date(store.updated_at).toLocaleString('fr-FR')}
          </span>
          <span>{store.jobs.length} offre(s) au total</span>
        </footer>
      </main>
    </div>
  );
}

// --- Cartes et états --------------------------------------------------------

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: 'zinc' | 'blue' | 'green';
}) {
  const accentClass = {
    zinc: 'bg-zinc-900 text-white',
    blue: 'bg-blue-50 text-blue-700 ring-1 ring-blue-100',
    green: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100',
  }[accent];

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </p>
      <div className="mt-2 flex items-baseline gap-3">
        <span className="text-3xl font-semibold text-zinc-900">{value}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${accentClass}`}
        >
          {accent === 'blue' ? 'actif' : accent === 'green' ? 'traité' : 'total'}
        </span>
      </div>
    </div>
  );
}

function Toast({
  kind,
  message,
  onClose,
}: {
  kind: 'info' | 'error';
  message: string;
  onClose: () => void;
}) {
  const style =
    kind === 'error'
      ? 'border-red-200 bg-red-50 text-red-800'
      : 'border-blue-200 bg-blue-50 text-blue-800';
  return (
    <div
      className={`mb-6 flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${style}`}
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onClose}
        className="shrink-0 rounded-md px-2 py-0.5 text-xs font-medium opacity-70 transition hover:opacity-100"
      >
        Fermer
      </button>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50">
      <div className="flex flex-col items-center gap-3 text-zinc-500">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900" />
        <p className="text-sm">Chargement des leads…</p>
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-6">
      <div className="w-full max-w-md rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-lg font-semibold text-red-800">
          Impossible de charger les leads
        </p>
        <p className="mt-2 text-sm text-red-700">{message}</p>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-100 text-zinc-400">
        <SearchIcon />
      </div>
      <p className="text-sm font-medium text-zinc-700">Aucune offre à afficher</p>
      <p className="max-w-sm text-sm text-zinc-500">
        Lance une ingestion ou ajuste les filtres pour voir apparaître des offres
        ici.
      </p>
    </div>
  );
}

// --- Navigation tabs --------------------------------------------------------

function StatusTab({
  label,
  value,
  current,
  preserved,
  pathname,
}: {
  label: string;
  value: JobFilter;
  current: JobFilter;
  preserved: URLSearchParams;
  pathname: string;
}) {
  const active = current === value;
  const params = new URLSearchParams(preserved);
  params.set('status', value);
  return (
    <Link
      href={`${pathname}?${params.toString()}`}
      className={
        active
          ? 'rounded-md bg-white px-3 py-1.5 font-medium text-zinc-900 shadow-sm'
          : 'rounded-md px-3 py-1.5 text-zinc-600 transition hover:text-zinc-900'
      }
    >
      {label}
    </Link>
  );
}

// --- Table ------------------------------------------------------------------

function JobsTable({
  jobs,
  onUpdated,
}: {
  jobs: Job[];
  onUpdated: () => Promise<void>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-100 bg-zinc-50/50 text-left text-xs uppercase tracking-wider text-zinc-500">
            <th className="px-6 py-3 font-medium">Date</th>
            <th className="px-3 py-3 font-medium">Source</th>
            <th className="px-3 py-3 font-medium">Entreprise · Poste</th>
            <th className="px-3 py-3 font-medium">Dép.</th>
            <th className="px-3 py-3 font-medium">Métier</th>
            <th className="px-3 py-3 font-medium">Statut</th>
            <th className="px-3 py-3 font-medium">Contact</th>
            <th className="px-3 py-3 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr
              key={job.id}
              className="border-b border-zinc-50 transition hover:bg-zinc-50/50"
            >
              <td className="whitespace-nowrap px-6 py-3 text-zinc-600">
                {formatDate(job.posted_at) ?? '—'}
              </td>
              <td className="px-3 py-3">
                <SourceBadge source={job.source} />
              </td>
              <td className="px-3 py-3">
                <div className="flex flex-col">
                  <span className="font-medium text-zinc-900">
                    {job.company_name}
                  </span>
                  <span className="text-xs text-zinc-500">{job.job_title}</span>
                  {job.source_url && (
                    <a
                      href={job.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-0.5 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                    >
                      Voir l&apos;offre
                      <ExternalLinkIcon />
                    </a>
                  )}
                </div>
              </td>
              <td className="whitespace-nowrap px-3 py-3 text-zinc-600">
                {job.departement ?? '—'}
              </td>
              <td className="px-3 py-3 text-zinc-600">
                <div className="flex flex-col">
                  <span>{job.rome_label ?? '—'}</span>
                  {job.sector && (
                    <span className="text-xs text-zinc-400">{job.sector}</span>
                  )}
                </div>
              </td>
              <td className="px-3 py-3">
                <StatusBadge status={job.status} />
              </td>
              <td className="px-3 py-3 text-xs text-zinc-600">
                <ContactCell job={job} />
              </td>
              <td className="px-3 py-3 text-right">
                <ProspectButton job={job} onUpdated={onUpdated} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContactCell({ job }: { job: Job }) {
  const parts = [job.contact_name, job.contact_email, job.contact_phone].filter(
    (v): v is string => v !== null && v !== '',
  );
  if (parts.length === 0) return <span className="text-zinc-300">—</span>;
  return <span className="whitespace-pre-line">{parts.join('\n')}</span>;
}

function SourceBadge({ source }: { source: Job['source'] }) {
  return (
    <span className="inline-flex rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">
      {SOURCE_LABEL[source]}
    </span>
  );
}

function StatusBadge({ status }: { status: Job['status'] }) {
  if (status === 'new') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-100">
        <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />À prospecter
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-100">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      Prospecté
    </span>
  );
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

// --- Icônes (inline SVG, pas de dépendance) ---------------------------------

function BriefcaseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

function DownloadCloudIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.3 8.3" />
      <path d="M12 12v9" />
      <path d="m8 17 4 4 4-4" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}
