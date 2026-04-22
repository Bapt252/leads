'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';

// Barre de 3 selects + bouton "Effacer" qui écrit dans l'URL.
// Client Component pour que le changement d'un select déclenche directement
// la navigation.

interface FiltersBarProps {
  departements: string[];
  sectors: string[];
  romeLabels: string[];
  current: {
    departement?: string;
    sector?: string;
    rome_label?: string;
  };
}

export function FiltersBar({
  departements,
  sectors,
  romeLabels,
  current,
}: FiltersBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const hasAnyFilter = Boolean(
    current.departement || current.sector || current.rome_label,
  );

  function update(key: string, value: string): void {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  function clearAll(): void {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('departement');
    params.delete('sector');
    params.delete('rome_label');
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <FilterSelect
        label="Département"
        value={current.departement ?? ''}
        options={departements}
        onChange={(v) => update('departement', v)}
      />
      <FilterSelect
        label="Secteur"
        value={current.sector ?? ''}
        options={sectors}
        onChange={(v) => update('sector', v)}
      />
      <FilterSelect
        label="Métier"
        value={current.rome_label ?? ''}
        options={romeLabels}
        onChange={(v) => update('rome_label', v)}
      />
      {hasAnyFilter && (
        <button
          type="button"
          onClick={clearAll}
          className="ml-1 text-xs font-medium text-zinc-500 underline-offset-2 transition hover:text-zinc-900 hover:underline"
        >
          Effacer
        </button>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const hasValue = value !== '';
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-lg border px-3 py-1.5 text-sm transition focus:outline-none focus:ring-2 focus:ring-zinc-900/10 ${
        hasValue
          ? 'border-zinc-900 bg-zinc-900 text-white'
          : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300'
      }`}
      aria-label={label}
    >
      <option value="">Tous — {label}</option>
      {options.map((opt) => (
        <option key={opt} value={opt} className="bg-white text-zinc-700">
          {opt}
        </option>
      ))}
    </select>
  );
}
