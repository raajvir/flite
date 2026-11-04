import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
  // GitHub Pages serves the site from /flite/; local dev stays at /.
  base: mode === 'production' ? '/flite/' : '/',
  worker: { format: 'es' },
  build: { target: 'es2022' }, // top-level await (tracks load on demand)
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
}));
