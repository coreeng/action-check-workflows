import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  sourcemap: true,
  dts: true,
  clean: true,
  platform: 'node',
  noExternal: [
    '@actions/core',
    '@actions/exec',
    '@actions/github',
    '@actions/workflow-parser',
    'picomatch'
  ]
});
