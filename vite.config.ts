import { defineConfig } from 'vitest/config';

export default defineConfig({
  worker: { format: 'es' },
  build: { target: 'es2022' }, // top-level await (tracks load on demand)
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
