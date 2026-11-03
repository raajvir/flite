import { defineConfig } from 'vitest/config';

export default defineConfig({
  worker: { format: 'es' },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
