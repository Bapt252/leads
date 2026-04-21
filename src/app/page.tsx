import Link from 'next/link';
import {
  getDistinctValues,
  getJobs,
  type Job,
  type JobFilter,
} from '@/lib/db';
import { ingestAllAction, markAllProspectedAction } from './actions';
import { FiltersBar } from './FiltersBar';

// Lecture du filtre statut depuis ?status=, valeur par défaut "new".
function parseStatus(raw: string | undefined): JobFilter {
  if (raw === 'prospected' || raw === 'all') return raw;
  return 'new';
}

// Normalise un paramètre optionnel de searchParams en string|undefined.
function asString(raw: string | string[] | undefined): string | undefined {
  if (typeof raw === 'string' && raw !== '') return raw;
  return undefined;
}

const SOURCE_LABEL: Record<Job['source'], string> = {
  france_travail: 'France Travail',
  indeed: 'Indeed',
  linkedin: 'LinkedIn',
};

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    departement?: string;
    sector?: string;
    rome_label?: string;
  }>;
}) {
  const params = await searchParams;
  const status = parseStatus(params.status);
  const departement = asString(params.departement);
  const sector = asString(params.sector);
  const rome_label = asString(params.rome_label);

  const jobs = getJobs({ status, departement, sector, rome_label });
  const departements = getDistinctValues('departement');
  const sectors = getDistinctValues('sector');
  const romeLabels = getDistinctValues('rome_label');

  const newCount =
    status === 'prospected' ? 0 : jobs.filter((j) => j.status === 'new').length;

  // URL paramétrée pour préserver les filtres en basculant d'onglet statut.
  const statusLinkBase = new URLSearchParams();
  if (departement) statusLinkBase.set('departement', departement);
  if (sector) statusLinkBase.set('sector', sector);
  if (rome_label) statusLinkBase.set('rome_label', rome_label);

  const exportParams = new URLSearchParams(statusLinkBase);
  exportParams.set('status', status);

  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Leads</h1>
          <p className="text-sm text-zinc-500">
            Offres d&apos;emploi IDF — France Travail · Indeed · LinkedIn
          </p>
        </div>
        <form action={ingestAllAction}>
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700"
          >
            Ingérer maintenant
          </button>
        </form>
      </header>

      <nav className="mb-4 flex gap-1 text-sm">
        <StatusTab
          label="New"
          value="new"
          current={status}
          preserved={statusLinkBase}
        />
        <StatusTab
          label="Prospected"
          value="prospected"
          current={status}
          preserved={statusLinkBase}
        />
        <StatusTab
          label="All"
          value="all"
          current={status}
          preserved={statusLinkBase}
        />
      </nav>

      <FiltersBar
        departements={departements}
        sectors={sectors}
        romeLabels={romeLabels}
        current={{ departement, sector, rome_label }}
      />

      <div className="mb-4 flex gap-2">
        {newCount > 0 && (
          <form action={markAllProspectedAction.bind(null, status)}>
            <button
              type="submit"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm transition hover:bg-zinc-50"
            >
              Tout marquer prospecté ({newCount})
            </button>
          </form>
        )}
        <a
          href={`/api/export?${exportParams.toString()}`}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm transition hover:bg-zinc-50"
        >
          Export CSV
        </a>
      </div>

      {jobs.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500">
          Aucune offre ne correspond aux filtres. Clique sur «&nbsp;Ingérer
          maintenant&nbsp;» ou ajuste les filtres ci-dessus.
        </p>
      ) : (
        <JobsTable jobs={jobs} />
      )}
    </main>
  );
}

function StatusTab({
  label,
  value,
  current,
  preserved,
}: {
  label: string;
  value: JobFilter;
  current: JobFilter;
  preserved: URLSearchParams;
}) {
  const active = current === value;
  const params = new URLSearchParams(preserved);
  params.set('status', value);
  return (
    <Link
      href={`/?${params.toString()}`}
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

function JobsTable({ jobs }: { jobs: Job[] }) {
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
            <th className="px-3 py-2 font-medium">Lien</th>
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
              <td className="px-3 py-2 text-zinc-600">
                {job.rome_label ?? '—'}
              </td>
              <td className="px-3 py-2 text-zinc-600">{job.sector ?? '—'}</td>
              <td className="px-3 py-2">
                <StatusBadge status={job.status} />
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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
