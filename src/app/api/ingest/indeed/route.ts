import { NextResponse } from 'next/server';
import { ingestIndeed } from '@/lib/ingest/indeed';

export async function POST() {
  const result = await ingestIndeed();
  return NextResponse.json(result);
}
