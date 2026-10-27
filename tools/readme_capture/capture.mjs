#!/usr/bin/env node
// Records README footage of the real Gitpicky app.
//
// readme_media's own `capture` step drives Godot games. Gitpicky is an Electron
// app, so this script plays that part: it builds a demo repository, launches
// the app with Playwright, clicks through each feature like a person would,
// and saves every frame as a PNG in readme_media's layout
// (<work>/<recording>/frames/f00000000.png). After that, readme_media's
// `contact` and `build` commands work unchanged.
//
//   npm run build
//   node tools/readme_capture/capture.mjs
//
// Frames are screenshots taken after each step, so timing is set by frame
// counts rather than the clock: re-recording gives the same footage.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { DEMO, buildDemoRepo } from './demo-repo.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const CONFIG = resolve(process.argv[2] ?? join(HERE, 'readme_media.json'));
const cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));
const WORK = resolve(dirname(CONFIG), cfg.work ?? '.work');
const RECORDING = 'showcase';
const FRAMES = join(WORK, RECORDING, 'frames');
const TOTAL = cfg.recordings[RECORDING].frames;
const FIRST = cfg.hero.first;
const SEGMENT = cfg.hero.segment;
const VIEW = { width: 1280, height: 720 };

// ------------------------------------------------------------------ setup

rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });
const home = join(WORK, 'home');
rmSync(home, { recursive: true, force: true });
mkdirSync(home, { recursive: true });
const repo = buildDemoRepo(join(WORK, 'demo'));
const env = { ...process.env, GITPICKY_HOME: home, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' };
delete env.ELECTRON_RUN_AS_NODE;

const electronPath = (await import('electron')).default;
const app = await electron.launch({
  executablePath: electronPath,
  args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), ROOT, '--repo', repo],
  env,
});
const page = await app.firstWindow();
await page.setViewportSize(VIEW);
await page.emulateMedia({ colorScheme: 'dark' });
await page.waitForSelector('.row');

// A visible pointer, since screenshots don't include the system cursor.
await page.addStyleTag({
  content: `
  #rm-cursor { position: fixed; z-index: 99999; pointer-events: none; width: 22px; height: 28px;
    transform: translate(-3px, -2px); filter: drop-shadow(0 2px 3px rgba(0,0,0,.5)); }
  #rm-ring { position: fixed; z-index: 99998; pointer-events: none; width: 34px; height: 34px;
    margin: -17px 0 0 -17px; border-radius: 50%; border: 3px solid #f39a45; opacity: 0; }`,
});
await page.evaluate(() => {
  const c = document.createElement('div');
  c.id = 'rm-cursor';
  c.innerHTML =
    '<svg viewBox="0 0 22 28" width="22" height="28"><path d="M2 2 L2 22 L7.5 17 L11 25.5 L14.5 24 L11 15.8 L18.5 15.8 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const r = document.createElement('div');
  r.id = 'rm-ring';
  document.body.append(c, r);
});

// ------------------------------------------------------------------ frames

let frame = 0;
let last = null;
let pos = { x: 640, y: 420 };

async function shot(times = 1) {
  last = await page.screenshot();
  for (let i = 0; i < times; i++) {
    if (frame >= TOTAL) throw new Error(`recording is longer than ${TOTAL} frames`);
    writeFileSync(join(FRAMES, `f${String(frame).padStart(8, '0')}.png`), last);
    frame++;
  }
}

/** Repeats the current picture for `n` frames. */
async function hold(n) {
  if (!last) await shot();
  for (let i = 0; i < n; i++) {
    writeFileSync(join(FRAMES, `f${String(frame).padStart(8, '0')}.png`), last);
    frame++;
  }
}

/** Holds the last picture until frame `end`; fails if the scene ran long. */
async function padTo(end, name) {
  if (frame > end) throw new Error(`segment "${name}" needs ${frame - (end - SEGMENT)} frames; it has ${SEGMENT}`);
  await hold(end - frame);
}

async function placeCursor(x, y, ring = false) {
  await page.evaluate(
    ({ x, y, ring }) => {
      const c = document.getElementById('rm-cursor');
      c.style.left = `${x}px`;
      c.style.top = `${y}px`;
      const r = document.getElementById('rm-ring');
      r.style.left = `${x}px`;
      r.style.top = `${y}px`;
      r.style.opacity = ring ? '0.9' : '0';
    },
    { x, y, ring },
  );
}

async function moveTo(x, y, steps = 7) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    await placeCursor(pos.x + (x - pos.x) * e, pos.y + (y - pos.y) * e);
    await shot();
  }
  pos = { x, y };
}

/** Moves the pointer to an element, shows the click and clicks it for real. */
async function click(selector, { settle = 350, after = 4 } = {}) {
  const target = page.locator(selector).first();
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error(`nothing to click: ${selector}`);
  const x = Math.round(box.x + Math.min(box.width / 2, 60));
  const y = Math.round(box.y + box.height / 2);
  await moveTo(x, y);
  await placeCursor(x, y, true);
  await shot(2);
  await target.click();
  await page.waitForTimeout(settle);
  await placeCursor(x, y, false);
  await shot(after);
}

/** Types into a field a few letters per frame. */
async function type(selector, text, perFrame = 3) {
  const field = page.locator(selector).first();
  await field.click();
  for (let i = 0; i < text.length; i += perFrame) {
    await field.pressSequentially(text.slice(i, i + perFrame));
    await shot();
  }
}

async function scrollDialog(px) {
  for (let i = 0; i < 6; i++) {
    await page.evaluate((d) => {
      const el = document.querySelector('.dialog');
      if (el) el.scrollTop += d;
    }, px / 6);
    await shot();
  }
}

// ------------------------------------------------------------------ scenes

// Title: the history with the "How to read this" panel.
await placeCursor(pos.x, pos.y);
await shot();
await padTo(FIRST, 'title');

const scenes = [
  [
    'commit',
    async () => {
      await click('.row-working');
      await type('.commit-message', 'Make the pause menu resumable');
      await click('.actions .primary', { settle: 600 });
      await hold(28);
      await click('.dialog-actions .primary', { settle: 900, after: 18 });
    },
  ],
  [
    'merge',
    async () => {
      await click('.row .badge-branch:not(.badge-current) >> text=art/new-sprites');
      await hold(6);
      await click('text=Merge art/new-sprites into main', { settle: 700 });
      await hold(28);
      await click('.dialog-actions .primary', { settle: 900, after: 18 });
    },
  ],
  [
    'authors',
    async () => {
      await click('.row >> text=Add pause menu');
      await hold(4);
      await click('text=Fix author / remove co-authors…', { settle: 400 });
      // "Only change commits by" is already filled in with this commit's (old) email.
      await moveTo(320, 640);
      await hold(14);
      await click('.dialog .primary', { settle: 900 });
      await hold(24);
      await scrollDialog(400);
      await hold(10);
      await click('.dialog-actions .primary', { settle: 1000, after: 20 });
    },
  ],
  [
    'assistant',
    async () => {
      // A real MCP client asks for the change, exactly as Claude would.
      const client = new Client({ name: 'readme-capture', version: '1.0.0' });
      await client.connect(
        new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'dist', 'mcp', 'gitpicky-mcp.js')], env }),
      );
      await moveTo(900, 560);
      await hold(6);
      await client.callTool({
        name: 'propose_change',
        arguments: {
          repo_path: repo,
          operation: { type: 'create_branch', name: 'levels/ice-cave', switchTo: false },
          reason: 'You asked to start the ice cave level without touching main.',
          wait_seconds: 0,
        },
      });
      await page.waitForSelector('.dialog-plan');
      await page.waitForTimeout(500);
      await shot(30);
      await click('.dialog-actions .primary', { settle: 900, after: 16 });
      await client.close();
    },
  ],
  [
    'learn',
    async () => {
      await click('.tab >> text=Learn');
      await type('.learn-search', 'detached', 2);
      await click('.learn-term >> nth=0', { after: 22 });
      await click('.chip >> text=Branch', { after: 20 });
    },
  ],
];

for (const [n, [name, run]] of scenes.entries()) {
  const end = FIRST + (n + 1) * SEGMENT;
  await run();
  console.log(`${name}: ${frame - (end - SEGMENT)} of ${SEGMENT} frames`);
  await padTo(end, name);
}
await hold(TOTAL - frame);
await app.close();
console.log(`${frame} frames in ${FRAMES}`);
