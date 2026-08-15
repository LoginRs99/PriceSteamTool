import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    pool: 'vmThreads',
    fileParallelism: false,
    isolate: false,
    setupFiles: ['./tests/setup.ts'],
    env: {
      DB_PATH: ':memory:'
    }
  }
});

