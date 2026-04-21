import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // better-sqlite3 est un module natif : on l'exclut du bundler côté serveur.
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
