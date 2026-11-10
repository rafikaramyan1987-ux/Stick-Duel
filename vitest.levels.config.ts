import { defineConfig } from 'vitest/config';

// Level checker (npm run levels:check): one test file per world, run in parallel workers.
export default defineConfig({
  test: {
    include: ['tests/levels/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30 * 60_000,
    pool: 'forks',
    maxWorkers: 4,
  },
});
