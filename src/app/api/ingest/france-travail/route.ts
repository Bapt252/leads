import { NextResponse } from 'next/server';
import { ingestFranceTravail } from '@/lib/ingest/france-travail';

export async function POST() {
  const result = await ingestFranceTravail();
  return NextResponse.json(result);
}
