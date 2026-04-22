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
  const [toast, setToast] = useState<string | null>(null);

  const status = parseStatus(searchParams.get('status'));
  const departement = asString(searchParams.get('departement'));
  const sector = asString(searchParams.get('sector'));
  const rome_label = asString(searchParams.get('rome_label'));

  // Le flag "loading" est dérivé de l'état : on évite les setState synchrones
  // dans l'effet de chargement initial (anti-pattern React moderne).
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
    // Chargement initial depuis le réseau : les setState de reload() sont
    // tous faits APRÈS un await donc non synchrones, mais la règle react-hooks
    // ne peut pas le vérifier statiquement.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  if (!store && error) {
    return <p className="p-6 text-sm text-red-600">Erreur : {error}</p>;
  }
  if (!store) {
    return <p className="p-6 text-sm text-zinc-500">Chargement…</p>;
  }

  const jobs = filterJobs(store.jobs, { status, departement, sector, rome_label });
  const departements = distinctValues(store.jobs, 'departement');
  const sectors = distinctValues(store.jobs, 'sector');
  const romeLabels = distinctValues(store.jobs, 'rome_label');
  const newCount =
    status === 'prospected' ? 0 : jobs.filter((j) => j.status === 'new').length;

  // URL paramétrée pour préserver les filtres en basculant d'onglet statut.
  const statusLinkBase = new URLSearchParams();
  if (departement) statusLinkBase.set('departement', departement);
  if (sector) statusLinkBase.set('sector', sector);
  if (rome_label) statusLinkBase.set('rome_label', rome_label);

  async function handleIngest() {
    try {
      await triggerIngest();
      setToast(
        'Ingestion lancée. Le workflow prend ~1-2 min — clique sur « Rafraîchir » dans un instant.',
      );
    } catch (e) {
      setToast(`Échec : ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleMarkAllProspected() {
    const ids = jobs.filter((j) => j.status === 'new').map((j) => j.id);
    if (ids.length === 0) return;
    try {
      await markAllProspected(ids);
      setToast(`${ids.length} offre(s) basculée(s) en prospected.`);
      await reload();
    } catch (e) {
      setToast(`Échec : ${e instanceof Error ? e.message : String(e)}`);
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
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Leads</h1>
          <p className="text-sm text-zinc-500">
            Offres d&apos;emploi IDF — France Travail
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void reload()}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm transition hover:bg-zinc-50"
          >
            Rafraîchir
          </button>
          <button
            type="button"
            onClick={() => void handleIngest()}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700"
          >
            Ingérer maintenant
          </button>
        </div>
      </header>

      {toast && (
        <div className="mb-4 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">
          {toast}{' '}
          <button
            type="button"
            onClick={() => setToast(null)}
            className="ml-2 underline"
          >
            ok
          </button>
        </div>
      )}

      <nav className="mb-4 flex gap-1 text-sm">
        <StatusTab label="New" value="new" current={status} preserved={statusLinkBase} pathname={pathname} />
        <StatusTab label="Prospected" value="prospected" current={status} preserved={statusLinkBase} pathname={pathname} />
        <StatusTab label="All" value="all" current={status} preserved={statusLinkBase} pathname={pathname} />
      </nav>

      <FiltersBar
        departements={departements}
        sectors={sectors}
        romeLabels={romeLabels}
        current={{ departement, sector, rome_label }}
      />

      <div className="mb-4 flex gap-2">
        {newCount > 0 && (
          <button
            type="button"
            onClick={() => void handleMarkAllProspected()}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm transition hover:bg-zinc-50"
          >
            Tout marquer prospecté ({newCount})
          </button>
        )}
        <button
          type="button"
          onClick={handleExportCsv}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm transition hover:bg-zinc-50"
        >
          Export CSV
        </button>
      </div>

      {jobs.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500">
          Aucune offre ne correspond aux filtres. Clique sur «&nbsp;Ingérer
          maintenant&nbsp;» ou ajuste les filtres ci-dessus.
        </p>
      ) : (
        <JobsTable jobs={jobs} onUpdated={reload} />
      )}

      <p className="mt-4 text-xs text-zinc-400">
        Dernière màj du fichier :{' '}
        {new Date(store.updated_at).toLocaleString('fr-FR')} · {store.jobs.length}{' '}
        offre(s) au total
      </p>
    </main>
  );
}

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
          ? 'rounded-md bg-zinc-900 px-3 py-1.5 text-white'
          : 'rounded-md px-3 py-1.5 text-zinc-600 hover:bg-zinc-100'
      }
    >
      {label}
    </Link>
  );
}

function JobsTable({
  jobs,
  onUpdated,
}: {
  jobs: Job[];
  onUpdated: () => Promise<void>;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-zinc-200">
      <table className="min-w-full text-sm">
        <thead className="bg-zinc-50 text-left text-zinc-600">
          <tr>
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Source</th>
            <th className="px-3 py-2 font-medium">Entreprise</th>
            <th className="px-3 py-2 font-medium">Poste</th>
            <th className="px-3 py-2 font-medium">Dép.</th>
            <th className="px-3 py-2 font-medium">Métier</th>
            <th className="px-3 py-2 font-medium">Secteur</th>
            <th className="px-3 py-2 font-medium">Statut</th>
            <th className="px-3 py-2 font-medium">Contact</th>
            <th className="px-3 py-2 font-medium">Lien</th>
            <th className="px-3 py-2 font-medium">Action</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id} className="border-t border-zinc-100">
              <td className="whitespace-nowrap px-3 py-2 text-zinc-600">
                {formatDate(job.posted_at) ?? '—'}
              </td>
              <td className="px-3 py-2">{SOURCE_LABEL[job.source]}</td>
              <td className="px-3 py-2 font-medium">{job.company_name}</td>
              <td className="px-3 py-2">{job.job_title}</td>
              <td className="whitespace-nowrap px-3 py-2 text-zinc-600">
                {job.departement ?? '—'}
              </td>
              <td className="px-3 py-2 text-zinc-600">{job.rome_label ?? '—'}</td>
              <td className="px-3 py-2 text-zinc-600">{job.sector ?? '—'}</td>
              <td className="px-3 py-2">
                <StatusBadge status={job.status} />
              </td>
              <td className="px-3 py-2 text-xs text-zinc-600">
                <ContactCell job={job} />
              </td>
              <td className="px-3 py-2">
                {job.source_url ? (
                  <a
                    href={job.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    Voir
                  </a>
                ) : (
                  '—'
                )}
              </td>
              <td className="px-3 py-2">
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
  if (parts.length === 0) return <span className="text-zinc-400">—</span>;
  return <span className="whitespace-pre-line">{parts.join('\n')}</span>;
}

function StatusBadge({ status }: { status: Job['status'] }) {
  const className =
    status === 'new'
      ? 'rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700'
      : 'rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600';
  return <span className={className}>{status}</span>;
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
