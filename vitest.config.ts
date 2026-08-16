import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    pool: 'forks',
    fileParallelism: false,
    isolate: false,
    poolOptions: {
      forks: {
        singleFork: true
      }
    },
    setupFiles: ['./tests/setup.ts'],
    env: {
      DB_PATH: ':memory:'
    }
  }
});

