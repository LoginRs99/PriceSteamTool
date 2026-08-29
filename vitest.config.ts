import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    pool: 'forks',
    forks: {
      singleFork: true
    },
    fileParallelism: false,
    clearMocks: true,
    restoreMocks: true,
    projects: [
      {
        plugins: [react()],
        test: {
          name: 'server',
          globals: true,
          include: ['tests/unit/**', 'tests/integration/**'],
          environment: 'node',
          pool: 'forks',
          forks: {
            singleFork: true
          },
          fileParallelism: false,
          isolate: false,
          clearMocks: true,
          restoreMocks: true,
          mockReset: true,
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
