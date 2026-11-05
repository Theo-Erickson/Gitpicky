import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSnapshot } from '../src/core/history';
import { RepoWatcher, isNoise } from '../src/app/watcher';
import { makeRepo } from './helpers';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('RepoWatcher', () => {
  it('ignores git lock files and the .git folder itself, but not real changes', () => {
    expect(isNoise('.git')).toBe(true);
    expect(isNoise(join('.git', 'index.lock'))).toBe(true);
    expect(isNoise(join('.git', 'refs', 'heads', 'main.lock'))).toBe(true);
    expect(isNoise(join('.git', 'objects', 'ab', 'cdef'))).toBe(true);
    expect(isNoise(join('.git', 'index'))).toBe(false);
    expect(isNoise(join('.git', 'refs', 'heads', 'main'))).toBe(false);
    expect(isNoise('level.txt')).toBe(false);
    expect(isNoise('notes.lock')).toBe(false);
  });

  // Reading the repo used to touch .git/index.lock, which woke the watcher, which read the repo
  // again: an endless refresh loop that redrew the window twice a second and stole focus.
  it("isn't woken by Gitpicky reading the repository", async () => {
    const repo = makeRepo();
    repo.commit('first');
    repo.write('level.txt', 'edited');
    let changes = 0;
    const watcher = new RepoWatcher(() => changes++, 100);
    watcher.start(repo.dir);
    try {
      await wait(300);
      changes = 0;
      for (let i = 0; i < 3; i++) await readSnapshot(repo.dir, 50);
      await wait(500);
      expect(changes).toBe(0);
      repo.write('level.txt', 'edited again');
      await wait(500);
      expect(changes).toBeGreaterThan(0);
    } finally {
      watcher.stop();
    }
  });
});
