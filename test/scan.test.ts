import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readRepoInfo, scanForRepos, suggestedRoots } from '../src/app/scan';
import { SettingsStore } from '../src/app/settings';
import { makeRepo } from './helpers';

/** A fake .git folder: enough for the scanner, which never runs git. */
function fakeRepo(dir: string, branch = 'main'): void {
  mkdirSync(join(dir, '.git'), { recursive: true });
  writeFileSync(join(dir, '.git', 'HEAD'), `ref: refs/heads/${branch}\n`);
}

describe('scanForRepos', () => {
  it('finds repositories a few levels down and skips the usual noise', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gitpicky-scan-'));
    fakeRepo(join(root, 'game'));
    fakeRepo(join(root, 'clients', 'site'), 'feature/menu');
    fakeRepo(join(root, 'a', 'b', 'c', 'too-deep'));
    fakeRepo(join(root, 'node_modules', 'pkg'));
    fakeRepo(join(root, '.hidden', 'secret'));
    fakeRepo(join(root, 'game', 'nested-inside-a-repo'));
    const found = await scanForRepos([root]);
    expect(found.map((r) => r.name).sort()).toEqual(['game', 'site']);
    expect(found.find((r) => r.name === 'site')).toMatchObject({ root, branch: 'feature/menu' });
  });

  it('lists each repository once even if two scan folders overlap, and ignores missing folders', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gitpicky-scan-'));
    fakeRepo(join(root, 'projects', 'one'));
    const found = await scanForRepos([root, join(root, 'projects'), join(root, 'missing')]);
    expect(found).toHaveLength(1);
  });

  it('stops at the limit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gitpicky-scan-'));
    for (let i = 0; i < 8; i++) fakeRepo(join(root, `r${i}`));
    expect(await scanForRepos([root], { limit: 5 })).toHaveLength(5);
  });
});

describe('readRepoInfo', () => {
  it('reads the branch and a last-activity time from a real repository', () => {
    const repo = makeRepo();
    repo.commit('first');
    repo.git('switch', '-q', '-c', 'art/sprites');
    const info = readRepoInfo(repo.dir);
    expect(info.branch).toBe('art/sprites');
    expect(Date.parse(info.lastActivity)).toBeGreaterThan(0);
  });

  it('reports a detached HEAD as no branch', () => {
    const repo = makeRepo();
    repo.commit('first');
    repo.git('switch', '-q', '--detach', 'HEAD');
    expect(readRepoInfo(repo.dir).branch).toBeNull();
  });
});

describe('scan folders', () => {
  it('suggests only common project folders that exist', () => {
    const home = mkdtempSync(join(tmpdir(), 'gitpicky-home-'));
    mkdirSync(join(home, 'source', 'repos'), { recursive: true });
    mkdirSync(join(home, 'Projects'));
    const roots = suggestedRoots(home);
    expect(roots).toContain(join(home, 'source', 'repos'));
    expect(roots).toContain(join(home, 'Projects'));
    expect(roots).not.toContain(join(home, 'GitHub'));
  });

  it('uses the suggestions until you change the list, then remembers yours', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'gitpicky-settings-')), 'settings.json');
    const s = new SettingsStore(file);
    expect(s.scanRoots(['/a'])).toEqual(['/a']);
    s.addScanRoot('/b', ['/a']);
    s.removeScanRoot('/a', ['/a']);
    expect(new SettingsStore(file).scanRoots(['/a', '/c'])).toEqual(['/b']);
  });
});
