// Renders the SVG icon candidates in assets/icons to PNGs (256, 64, 32, 16).
// Usage: node scripts/render-icons.mjs  (needs a Playwright install; optional dev step)
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const { chromium } = await import('playwright');
const dir = join(process.cwd(), 'assets', 'icons');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const file of readdirSync(dir).filter((f) => f.endsWith('.svg'))) {
  const svg = readFileSync(join(dir, file), 'utf8');
  for (const size of [256, 64, 32, 16]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg style="width:${size}px;height:${size}px;display:block" `)}</body></html>`,
    );
    const png = await page.screenshot({ omitBackground: true });
    writeFileSync(join(dir, file.replace('.svg', `-${size}.png`)), png);
  }
}
await browser.close();
