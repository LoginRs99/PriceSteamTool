import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    pool: 'threads',
    fileParallelism: false,
    isolate: false,
    env: {
      NODE_ENV: 'test',
      DB_PATH: ':memory:'
    }
  }
});
