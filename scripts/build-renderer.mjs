// Bundles the window's code (src/renderer) into dist/renderer.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';

const out = 'dist/renderer';
mkdirSync(out, { recursive: true });

await build({
  entryPoints: ['src/renderer/main.ts'],
  bundle: true,
  outfile: `${out}/renderer.js`,
  platform: 'browser',
  format: 'iife',
  target: 'chrome130',
  sourcemap: true,
  logLevel: 'info',
});

copyFileSync('src/renderer/index.html', `${out}/index.html`);
copyFileSync('src/renderer/styles.css', `${out}/styles.css`);
