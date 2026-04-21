import { NextResponse, type NextRequest } from 'next/server';
import { getJobs, type JobFilter } from '@/lib/db';
import { jobsToCsv } from '@/lib/csv';

function parseFilter(raw: string | null): JobFilter {
  if (raw === 'prospected' || raw === 'all') return raw;
  return 'new';
}

export async function GET(req: NextRequest) {
  const filter = parseFilter(req.nextUrl.searchParams.get('status'));
  const jobs = getJobs(filter);
  const csv = jobsToCsv(jobs);
  const today = new Date().toISOString().slice(0, 10);
  const filename = `leads-${filter}-${today}.csv`;
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
