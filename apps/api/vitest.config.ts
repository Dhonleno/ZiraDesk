import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: './src/test/global-setup.ts',
    setupFiles: ['./src/test/vitest.setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    threads: false,
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 15_000,
    passWithNoTests: true,
  },
});
