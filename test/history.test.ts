import { describe, expect, it } from 'vitest';
import { parseDecorations, parseStatus, readCommitFiles, readSnapshot } from '../src/core/history';
import { makeRepo } from './helpers';

describe('parseDecorations', () => {
  it('understands HEAD, branches, remotes and tags', () => {
    const refs = parseDecorations('HEAD -> main, origin/main, origin/HEAD, tag: v1.0, feature', ['origin']);
    expect(refs).toEqual([
      { kind: 'head', name: 'HEAD' },
      { kind: 'branch', name: 'main', current: true },
      { kind: 'remote', name: 'origin/main' },
      { kind: 'tag', name: 'v1.0' },
      { kind: 'branch', name: 'feature' },
    ]);
  });

  it('marks a detached HEAD without a current branch', () => {
    expect(parseDecorations('HEAD, main', [])).toEqual([
      { kind: 'head', name: 'HEAD' },
      { kind: 'branch', name: 'main' },
    ]);
  });
});

describe('parseStatus', () => {
  it('reads branch info and staged/unstaged/untracked files', () => {
    const out = [
      '# branch.oid 1111111111111111111111111111111111111111',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '1 M. N... 100644 100644 100644 aaa bbb staged file.txt',
      '1 .M N... 100644 100644 100644 aaa bbb notes with space.md',
      '2 R. N... 100644 100644 100644 aaa bbb R100 new.txt',
      'old.txt',
      '? brand-new.txt',
      '',
    ].join('\0');
    const s = parseStatus(out);
    expect(s.branch).toBe('main');
    expect(s.upstream).toBe('origin/main');
    expect(s.ahead).toBe(2);
    expect(s.behind).toBe(1);
    expect(s.changes).toEqual([
      { path: 'staged file.txt', kind: 'modified', staged: true, from: undefined },
      { path: 'notes with space.md', kind: 'modified', staged: false },
      { path: 'new.txt', from: 'old.txt', kind: 'renamed', staged: true },
      { path: 'brand-new.txt', kind: 'untracked', staged: false },
    ]);
  });

  it('handles a detached HEAD in a new repo', () => {
    const s = parseStatus('# branch.oid (initial)\0# branch.head (detached)\0');
    expect(s.branch).toBeNull();
    expect(s.headHash).toBeNull();
  });
});

describe('readSnapshot', () => {
  it('works on an empty repository', async () => {
    const repo = makeRepo();
    const snap = await readSnapshot(repo.dir);
    expect(snap.commits).toEqual([]);
    expect(snap.status.branch).toBe('main');
  });

  it('reads commits, branches and tags from a real repository', async () => {
    const repo = makeRepo();
    repo.commit('first');
    repo.git('tag', 'v0.1');
    repo.git('switch', '-q', '-c', 'feature');
    repo.commit('feature work', 'feature.txt');
    repo.git('switch', '-q', 'main');
    repo.commit('main work');
    repo.git('merge', '-q', '--no-edit', 'feature');
    repo.write('untracked.txt', 'hi');

    const snap = await readSnapshot(repo.dir);
    expect(snap.branches.sort()).toEqual(['feature', 'main']);
    expect(snap.tags).toEqual(['v0.1']);
    expect(snap.commits).toHaveLength(4);
    expect(snap.commits[0].parents).toHaveLength(2);
    expect(snap.commits[0].refs).toContainEqual({ kind: 'branch', name: 'main', current: true });
    expect(snap.status.changes).toContainEqual({ path: 'untracked.txt', kind: 'untracked', staged: false });

    const files = await readCommitFiles(repo.dir, snap.commits.find((c) => c.subject === 'feature work')!.hash);
    expect(files).toEqual([{ path: 'feature.txt', kind: 'added', staged: true }]);
  });

  it('notices a merge in progress', async () => {
    const repo = makeRepo();
    repo.commit('base');
    repo.git('switch', '-q', '-c', 'other');
    repo.commit('other change');
    repo.git('switch', '-q', 'main');
    repo.commit('main change');
    expect(() => repo.git('merge', '-q', 'other')).toThrow();
    const snap = await readSnapshot(repo.dir);
    expect(snap.status.inProgress).toBe('merge');
    expect(snap.status.changes.some((c) => c.kind === 'conflicted')).toBe(true);
  });
});
