import * as esbuild from 'esbuild';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const resolve = p => join(__dirname, p);

// CSS loader plugin — injects styles into the bundle as a <style> tag at runtime
const cssInjectPlugin = {
  name: 'css-inject',
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, async args => {
      const css = readFileSync(args.path, 'utf-8');
      const escaped = JSON.stringify(css);
      return {
        contents: `
          const style = document.createElement('style');
          style.textContent = ${escaped};
          document.head.appendChild(style);
        `,
        loader: 'js',
      };
    });
  },
};

const sharedOpts = {
  bundle: true,
  minify: false,
  logLevel: 'info',
};

async function buildAll() {
  // 1. worker-service.cjs
  await esbuild.build({
    ...sharedOpts,
    entryPoints: [resolve('src/worker/index.js')],
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: resolve('scripts/worker-service.cjs'),
    external: ['better-sqlite3'],
    banner: { js: '#!/usr/bin/env bun\n"use strict";' },
  });

  // 2. worker-wrapper.cjs
  await esbuild.build({
    ...sharedOpts,
    entryPoints: [resolve('src/wrapper/index.js')],
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: resolve('scripts/worker-wrapper.cjs'),
    banner: { js: '#!/usr/bin/env bun\n"use strict";' },
  });

  // 3. app-bundle.js (UI)
  await esbuild.build({
    ...sharedOpts,
    entryPoints: [resolve('src/ui/index.js')],
    platform: 'browser',
    target: ['chrome100', 'firefox100'],
    format: 'iife',
    outfile: resolve('ui/app-bundle.js'),
    plugins: [cssInjectPlugin],
  });

  console.log('\nAll artifacts built successfully.');
}

buildAll().catch(e => { console.error(e); process.exit(1); });
