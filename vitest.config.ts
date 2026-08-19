import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true
      }
    },
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DB_PATH: ':memory:'
    }
  }
});
