import type { Job } from './store';

// Échappe une cellule selon RFC 4180 (guillemets autour si ",", "\"", "\n" ou "\r").
function escapeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const HEADERS = [
  'id',
  'source',
  'source_url',
  'company_name',
  'job_title',
  'location',
  'departement',
  'sector',
  'rome_label',
  'posted_at',
  'status',
  'prospected_at',
  'contact_name',
  'contact_email',
  'contact_phone',
  'notes',
  'created_at',
] as const;

export function jobsToCsv(jobs: Job[]): string {
  const lines: string[] = [HEADERS.join(',')];
  for (const j of jobs) {
    lines.push(
      [
        j.id,
        j.source,
        j.source_url,
        j.company_name,
        j.job_title,
        j.location,
        j.departement,
        j.sector,
        j.rome_label,
        j.posted_at,
        j.status,
        j.prospected_at,
        j.contact_name,
        j.contact_email,
        j.contact_phone,
        j.notes,
        j.created_at,
      ]
        .map(escapeCell)
        .join(','),
    );
  }
  return lines.join('\n');
}
