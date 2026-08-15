import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
        isolate: false
      }
    },
    fileParallelism: false,
    setupFiles: ['./tests/setup.ts'],
    env: {
      DB_PATH: ':memory:'
    }
  }
});
