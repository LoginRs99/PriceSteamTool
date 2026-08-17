import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    pool: 'forks',
    fileParallelism: false,
    isolate: false,
    env: {
      NODE_ENV: 'test',
      DB_PATH: ':memory:'
    }
  }
});
