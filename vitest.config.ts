import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Default to a fast Node environment. DOM-dependent suites opt in per-file
    // with a `// @vitest-environment happy-dom` pragma at the top of the file.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.worker.ts', 'src/**/*.worklet.ts', 'src/main.ts', 'src/**/types.ts'],
    },
  },
});
