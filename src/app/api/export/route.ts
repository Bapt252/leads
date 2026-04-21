import { NextResponse, type NextRequest } from 'next/server';
import { getJobs, type JobFilter } from '@/lib/db';
import { jobsToCsv } from '@/lib/csv';

function parseStatus(raw: string | null): JobFilter {
  if (raw === 'prospected' || raw === 'all') return raw;
  return 'new';
}

function asString(raw: string | null): string | undefined {
  if (raw && raw !== '') return raw;
  return undefined;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const status = parseStatus(sp.get('status'));
  const jobs = getJobs({
    status,
    departement: asString(sp.get('departement')),
    sector: asString(sp.get('sector')),
    rome_label: asString(sp.get('rome_label')),
  });
  const csv = jobsToCsv(jobs);
  const today = new Date().toISOString().slice(0, 10);
  const filename = `leads-${status}-${today}.csv`;
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
