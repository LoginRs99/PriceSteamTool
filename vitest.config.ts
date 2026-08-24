import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true
      }
    },
    fileParallelism: false,
    setupFiles: ['./tests/setup.ts'],
    env: {
      NODE_ENV: 'test',
      DB_PATH: ':memory:'
    }
  }
});
