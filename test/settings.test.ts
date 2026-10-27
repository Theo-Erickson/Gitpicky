import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeRecent } from '../src/app/recent';
import { MAX_RECENT, SettingsStore } from '../src/app/settings';
import { makeRepo } from './helpers';

const file = () => join(mkdtempSync(join(tmpdir(), 'gitpicky-settings-')), 'settings.json');

describe('recent repositories', () => {
  it('keeps the most recent first, without duplicates, up to the limit', () => {
    const f = file();
    const s = new SettingsStore(f);
    for (let i = 0; i < MAX_RECENT + 3; i++) s.rememberRepo(`/repos/r${i}`, new Date(2026, 0, 1, 0, i));
    s.rememberRepo('/repos/r5', new Date(2026, 0, 2));
    const list = s.recentRepos;
    expect(list).toHaveLength(MAX_RECENT);
    expect(list[0]).toEqual({ path: '/repos/r5', lastOpened: new Date(2026, 0, 2).toISOString() });
    expect(list.filter((e) => e.path === '/repos/r5')).toHaveLength(1);
    // Saved to disk and read back the same.
    expect(new SettingsStore(f).recentRepos).toEqual(list);
  });

  it('forgets a repository', () => {
    const s = new SettingsStore(file());
    s.rememberRepo('/a');
    s.rememberRepo('/b');
    s.forgetRepo('/a');
    expect(s.recentRepos.map((e) => e.path)).toEqual(['/b']);
  });

  it('reads the older plain list of paths and ignores junk', () => {
    const f = file();
    writeFileSync(f, JSON.stringify({ recentRepos: ['/old/one', 42, '', { path: '/new', lastOpened: 'x' }] }));
    expect(new SettingsStore(f).recentRepos).toEqual([
      { path: '/old/one', lastOpened: '' },
      { path: '/new', lastOpened: 'x' },
    ]);
  });

  it('survives a missing or broken settings file', () => {
    const f = file();
    writeFileSync(f, '{not json');
    const s = new SettingsStore(f);
    expect(s.recentRepos).toEqual([]);
    s.rememberRepo('/x');
    expect(JSON.parse(readFileSync(f, 'utf8')).recentRepos[0].path).toBe('/x');
  });

  it('reports branch, current and missing folders for the picker', async () => {
    const repo = makeRepo();
    repo.commit('first');
    repo.git('switch', '-q', '-c', 'feature/tiles');
    const gone = join(mkdtempSync(join(tmpdir(), 'gitpicky-gone-')), 'deleted-repo');
    mkdirSync(gone);
    const list = await describeRecent(
      [
        { path: repo.dir, lastOpened: '2026-01-01T00:00:00.000Z' },
        { path: gone, lastOpened: '' },
      ],
      repo.dir,
    );
    expect(list[0]).toMatchObject({ exists: true, branch: 'feature/tiles', current: true });
    expect(list[1]).toMatchObject({ name: 'deleted-repo', exists: false, branch: null, current: false });
  });
});
