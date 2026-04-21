import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Leads — Tenex',
  description: 'Outil interne de prospection B2B.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className="h-full antialiased">
      <body className="min-h-full bg-white text-zinc-900">{children}</body>
    </html>
  );
}
