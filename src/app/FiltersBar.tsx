'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';

// Barre de 3 selects + bouton "Effacer" qui écrit dans l'URL.
// Client Component pour que le changement d'un select déclenche directement la navigation.

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
    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
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
          className="text-zinc-500 underline hover:text-zinc-900"
        >
          Effacer les filtres
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
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm"
      aria-label={label}
    >
      <option value="">Tous — {label}</option>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}
