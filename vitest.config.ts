import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true
      }
    },
    fileParallelism: false,
    projects: [
      {
        plugins: [react()],
        test: {
          name: 'server',
          globals: true,
          include: ['tests/unit/**', 'tests/integration/**'],
          environment: 'node',
          pool: 'forks',
          poolOptions: {
            forks: {
              singleFork: true
            }
          },
          fileParallelism: false,
          isolate: false,
          setupFiles: ['./tests/setup.ts'],
          env: {
            NODE_ENV: 'test',
            DB_PATH: ':memory:'
          }
        }
      },
      {
        plugins: [react()],
        test: {
          name: 'client',
          globals: true,
          include: ['tests/client/**', 'src/client/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['./tests/setupClient.ts']
        }
      }
    ]
  }
});
