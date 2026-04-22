import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Export statique pour déploiement sur GitHub Pages.
  output: 'export',
  // Le site est servi sous bapt252.github.io/leads/, donc les liens internes
  // doivent être préfixés par /leads (Next le fait automatiquement).
  basePath: '/leads',
  // GitHub Pages ne gère pas le rewrite `/a` → `/a.html` : on force les
  // slashes de fin pour obtenir des dossiers (`/a/index.html`) qui
  // fonctionnent nativement.
  trailingSlash: true,
  // Pas de service d'optimisation côté serveur en mode static : on sert
  // les images telles quelles.
  images: { unoptimized: true },
};

export default nextConfig;
