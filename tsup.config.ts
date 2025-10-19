import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  sourcemap: true,
  dts: true,
  clean: true,
  shims: true,
  platform: 'node',
  noExternal: [
    '@actions/core',
    '@actions/exec',
    '@actions/github',
    '@actions/workflow-parser',
    'picomatch'
  ],
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "const require = __createRequire(import.meta.url);",
      "globalThis.require ??= require;"
    ].join('\n')
  }
});
