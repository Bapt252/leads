import { Suspense } from 'react';
import { HomeClient } from './HomeClient';

// Wrapper requis en export static : HomeClient utilise useSearchParams,
// qui doit être encapsulé dans un boundary Suspense pour que le build
// statique puisse pré-rendre le HTML avant que les searchParams soient
// disponibles côté client.
export default function HomePage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Chargement…</p>}>
      <HomeClient />
    </Suspense>
  );
}
