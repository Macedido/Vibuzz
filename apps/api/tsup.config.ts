import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // Shared package is TypeScript source; bundle it into the build.
  noExternal: ['@vibuzz/shared'],
});
