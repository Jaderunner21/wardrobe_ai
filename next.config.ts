import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const config: NextConfig = {
  reactStrictMode: true,
  // There is a stray lockfile above this directory; without this Next infers the
  // wrong workspace root and traces the whole home folder into the deploy bundle.
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  typedRoutes: true,
  eslint: { ignoreDuringBuilds: false },
  typescript: { ignoreBuildErrors: false },
};

export default config;
