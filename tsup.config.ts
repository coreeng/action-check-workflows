import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  sourcemap: true,
  dts: true,
  clean: true,
  skipNodeModulesBundle: false,
  platform: 'node'
});
