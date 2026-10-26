import { describe, expect, it } from 'vitest';
import { readSnapshot } from '../src/core/history';
import { applyPreview, executePlan, formatCommand, planChange } from '../src/core/operations';
import { makeRepo } from './helpers';

function branchRepo() {
  const repo = makeRepo();
  const base = repo.commit('base');
  repo.git('switch', '-q', '-c', 'feature');
  const feat = repo.commit('feature work', 'feature.txt');
  repo.git('switch', '-q', 'main');
  return { ...repo, base, feat };
}

describe('planChange', () => {
  it('plans a new branch and previews the label', async () => {
    const repo = branchRepo();
    const plan = await planChange(repo.dir, { type: 'create_branch', name: 'art/new-sprites' });
    expect(plan.blockers).toEqual([]);
    expect(plan.risk).toBe('safe');
    expect(plan.steps[0].args).toEqual(['switch', '-c', 'art/new-sprites']);
    expect(plan.preview.head).toEqual({ branch: 'art/new-sprites', at: repo.base });
  });

  it('blocks bad branch names and duplicates', async () => {
    const repo = branchRepo();
    expect((await planChange(repo.dir, { type: 'create_branch', name: 'has space' })).blockers.length).toBeGreaterThan(0);
    expect((await planChange(repo.dir, { type: 'create_branch', name: 'feature' })).blockers[0]).toContain('already exists');
  });

  it('recognizes a fast-forward merge', async () => {
    const repo = branchRepo();
    const plan = await planChange(repo.dir, { type: 'merge', branch: 'feature' });
    expect(plan.blockers).toEqual([]);
    expect(plan.summary).toContain('fast-forward');
    expect(plan.preview.newCommits).toEqual([]);
    expect(plan.preview.moveRefs).toEqual([{ kind: 'branch', name: 'main', to: repo.feat }]);
  });

  it('predicts merge conflicts', async () => {
    const repo = branchRepo();
    repo.commit('main edits the same file', 'feature.txt');
    const plan = await planChange(repo.dir, { type: 'merge', branch: 'feature' });
    expect(plan.preview.newCommits[0].parents).toHaveLength(2);
    expect(plan.risk).toBe('careful');
    expect(plan.warnings.join(' ')).toContain('feature.txt');
  });

  it('marks hard reset as destructive and warns about lost commits', async () => {
    const repo = branchRepo();
    repo.commit('second');
    repo.write('notes.txt', 'unsaved edit');
    const plan = await planChange(repo.dir, { type: 'reset', to: repo.base, mode: 'hard' });
    expect(plan.risk).toBe('destructive');
    expect(plan.warnings.length).toBe(2);
  });

  it('refuses to delete an unmerged branch unless forced', async () => {
    const repo = branchRepo();
    const plan = await planChange(repo.dir, { type: 'delete_branch', name: 'feature' });
    expect(plan.risk).toBe('destructive');
    expect(plan.blockers.length).toBe(1);
    const forced = await planChange(repo.dir, { type: 'delete_branch', name: 'feature', force: true });
    expect(forced.blockers).toEqual([]);
    expect(forced.steps[0].args).toEqual(['branch', '-D', 'feature']);
  });

  it('blocks push without a remote', async () => {
    const repo = branchRepo();
    const plan = await planChange(repo.dir, { type: 'push' });
    expect(plan.blockers.join(' ')).toContain('no remote');
  });
});

describe('applyPreview', () => {
  it('adds a ghost commit and moves HEAD and the branch onto it', async () => {
    const repo = branchRepo();
    repo.write('notes.txt', 'changed');
    const snap = await readSnapshot(repo.dir);
    const plan = await planChange(repo.dir, { type: 'commit', message: 'Update notes' }, snap);
    const preview = applyPreview(snap.commits, plan.preview);
    expect(preview[0]).toMatchObject({ hash: 'preview-0', preview: true, parents: [repo.base] });
    expect(preview[0].refs).toEqual([
      { kind: 'head', name: 'HEAD' },
      { kind: 'branch', name: 'main', current: true },
    ]);
    const old = preview.find((c) => c.hash === repo.base)!;
    expect(old.refs.some((r) => r.kind === 'head' || r.name === 'main')).toBe(false);
  });
});

describe('executePlan', () => {
  it('commits only the picked files', async () => {
    const repo = branchRepo();
    repo.write('a.txt', 'a');
    repo.write('b.txt', 'b');
    const result = await executePlan(repo.dir, { type: 'commit', message: 'Add a', files: ['a.txt'] });
    expect(result.ok).toBe(true);
    expect(repo.git('log', '-1', '--format=%s').trim()).toBe('Add a');
    expect(repo.git('status', '--porcelain')).toContain('?? b.txt');
  });

  it('undoes the last commit but keeps the changes staged', async () => {
    const repo = branchRepo();
    repo.commit('oops');
    const result = await executePlan(repo.dir, { type: 'undo_last_commit' });
    expect(result.ok).toBe(true);
    expect(repo.git('rev-parse', 'HEAD').trim()).toBe(repo.base);
    expect(repo.git('status', '--porcelain')).toContain('M  notes.txt');
  });

  it('stashes and pops, including untracked files', async () => {
    const repo = branchRepo();
    repo.write('new.txt', 'new');
    expect((await executePlan(repo.dir, { type: 'stash' })).ok).toBe(true);
    expect(repo.git('status', '--porcelain')).toBe('');
    expect((await executePlan(repo.dir, { type: 'stash_pop' })).ok).toBe(true);
    expect(repo.git('status', '--porcelain')).toContain('new.txt');
  });

  it('discards changes to specific files only', async () => {
    const repo = branchRepo();
    repo.write('notes.txt', 'edit');
    repo.write('scratch.txt', 'tmp');
    repo.write('keep.txt', 'keep');
    const result = await executePlan(repo.dir, { type: 'discard_changes', files: ['notes.txt', 'scratch.txt'] });
    expect(result.ok).toBe(true);
    expect(repo.git('status', '--porcelain').trim()).toBe('?? keep.txt');
  });

  it('stops at the merge conflict and can abort it', async () => {
    const repo = branchRepo();
    repo.commit('clash', 'feature.txt');
    const merge = await executePlan(repo.dir, { type: 'merge', branch: 'feature' });
    expect(merge.ok).toBe(false);
    const snap = await readSnapshot(repo.dir);
    expect(snap.status.inProgress).toBe('merge');
    const blocked = await planChange(repo.dir, { type: 'create_branch', name: 'x' });
    expect(blocked.blockers[0]).toContain('merge is in progress');
    expect((await executePlan(repo.dir, { type: 'abort' })).ok).toBe(true);
    expect((await readSnapshot(repo.dir)).status.inProgress).toBeNull();
  });

  it('never runs a blocked plan', async () => {
    const repo = branchRepo();
    const result = await executePlan(repo.dir, { type: 'switch_branch', name: 'nope' });
    expect(result.ok).toBe(false);
    expect(result.log).toEqual([]);
  });
});

describe('formatCommand', () => {
  it('quotes arguments with spaces', () => {
    expect(formatCommand(['commit', '-m', 'Fix the thing'])).toBe('git commit -m "Fix the thing"');
  });
});
