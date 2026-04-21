import { NextResponse } from 'next/server';
import { ingestLinkedin } from '@/lib/ingest/linkedin';

export async function POST() {
  const result = await ingestLinkedin();
  return NextResponse.json(result);
}
