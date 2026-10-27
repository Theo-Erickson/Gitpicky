import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSnapshot } from '../src/core/history';
import { applyPreview, executePlan, planChange } from '../src/core/operations';
import { coAuthorsIn, parseRawCommit, rewriteRaw, stripCoAuthors } from '../src/core/rewrite';
import { makeRepo } from './helpers';

const ME = { name: 'Alex Morgan', email: 'alex@studio.example' };
const OLD = 'alex.old@example.net';

/** A repo with: base (Test), two commits by Alex's old email, one with a co-author, one by a teammate. */
function authoredRepo() {
  const repo = makeRepo();
  const commitAs = (msg: string, author: string, file: string) => {
    repo.write(file, msg);
    repo.git('add', file);
    repo.git('commit', '-q', `--author=${author}`, '-m', msg);
    return repo.git('rev-parse', 'HEAD').trim();
  };
  const base = repo.commit('base');
  const a = commitAs('Add jump', `Alex <${OLD}>`, 'jump.txt');
  const b = commitAs('Add dash\n\nCo-authored-by: Claude <noreply@anthropic.com>', `Alex <${OLD}>`, 'dash.txt');
  const c = commitAs('Teammate fix', 'Sam <sam@example.com>', 'fix.txt');
  return { ...repo, base, a, b, c };
}

const authors = (repo: { git: (...a: string[]) => string }) =>
  repo.git('log', '--format=%an <%ae>|%cn <%ce>', 'main').trim().split('\n');

describe('raw commit helpers', () => {
  it('keeps multi-line headers together and strips co-authors', () => {
    const raw = 'tree t\nparent p\nauthor A <a@x> 1 +0000\ncommitter A <a@x> 1 +0000\ngpgsig -----BEGIN\n line2\n -----END\n\nSubject\n\nBody\n\nCo-authored-by: X <x@y>\nco-authored-by: Y <y@z>\n';
    const parsed = parseRawCommit(raw);
    expect(parsed.headers).toHaveLength(5);
    expect(coAuthorsIn(parsed.message)).toEqual(['X <x@y>', 'Y <y@z>']);
    expect(stripCoAuthors(parsed.message)).toBe('Subject\n\nBody\n');
    const out = rewriteRaw(raw, { from: 'x', author: { name: 'B', email: 'b@x' }, removeCoAuthors: true }, new Map([['p', 'q']]));
    expect(out).toBe('tree t\nparent q\nauthor B <b@x> 1 +0000\ncommitter B <b@x> 1 +0000\n\nSubject\n\nBody\n');
  });
});

describe('rewrite_authors', () => {
  it('fixes only commits by the old email and removes co-authors', async () => {
    const repo = authoredRepo();
    const op = { type: 'rewrite_authors' as const, from: repo.a, author: ME, onlyAuthorEmail: OLD, removeCoAuthors: true };
    const plan = await planChange(repo.dir, op);
    expect(plan.blockers).toEqual([]);
    expect(plan.risk).toBe('careful');
    expect(plan.summary).toContain('sets the author of 2 commits');
    expect(plan.summary).toContain('3 commits get re-created');
    expect(plan.warnings.join(' ')).toContain('Co-author credit will be removed for: Claude <noreply@anthropic.com> (1 commit)');
    expect(plan.warnings.join(' ')).not.toContain('currently credited');

    const result = await executePlan(repo.dir, op);
    expect(result.ok).toBe(true);
    expect(authors(repo)).toEqual([
      'Sam <sam@example.com>|Test <test@example.com>',
      `${ME.name} <${ME.email}>|${ME.name} <${ME.email}>`,
      `${ME.name} <${ME.email}>|${ME.name} <${ME.email}>`,
      'Test <test@example.com>|Test <test@example.com>',
    ]);
    expect(repo.git('log', '--format=%B', '-n', '1', 'main~1')).not.toContain('Co-authored-by');
    // Files and the base commit are untouched; the working folder is clean.
    expect(repo.git('rev-parse', 'main~3').trim()).toBe(repo.base);
    expect(repo.git('rev-parse', 'main^{tree}').trim()).toBe(repo.git('rev-parse', `${repo.c}^{tree}`).trim());
    expect(repo.git('status', '--porcelain')).toBe('');
    // A backup of the old history exists and stays out of the picture.
    const backup = repo.git('for-each-ref', '--format=%(refname) %(objectname)', 'refs/gitpicky').trim();
    expect(backup).toMatch(new RegExp(`^refs/gitpicky/backup/main/\\d{8}-\\d{6} ${repo.c}$`));
    const snap = await readSnapshot(repo.dir);
    expect(snap.commits.map((c) => c.hash)).not.toContain(repo.c);
    expect(result.log[0].output).toContain('Re-created 3 commits');
  });

  it('spells out whose credit changes when not limited to one email', async () => {
    const repo = authoredRepo();
    const plan = await planChange(repo.dir, { type: 'rewrite_authors', from: repo.a, author: ME });
    expect(plan.warnings.join(' ')).toContain(`currently credited to: Alex <${OLD}> (2 commits), Sam <sam@example.com> (1 commit)`);
    const limited = await planChange(repo.dir, { type: 'rewrite_authors', from: repo.a, author: ME, onlyAuthorEmail: OLD });
    expect(limited.warnings.join(' ')).not.toContain('currently credited');
  });

  it('treats pushed commits as destructive and explains the force push', async () => {
    const repo = authoredRepo();
    const remote = mkdtempSync(join(tmpdir(), 'gitpicky-remote-'));
    execFileSync('git', ['init', '-q', '--bare', remote]);
    repo.git('remote', 'add', 'origin', remote);
    repo.git('push', '-q', '-u', 'origin', 'main');
    repo.git('tag', 'v1', repo.b);
    repo.git('branch', 'old-feature', repo.b);
    const plan = await planChange(repo.dir, { type: 'rewrite_authors', from: repo.a, author: ME, onlyAuthorEmail: OLD });
    expect(plan.risk).toBe('destructive');
    const text = plan.warnings.join(' ');
    expect(text).toContain('3 of these commits are already on origin/main');
    expect(text).toContain('force push');
    expect(text).toContain('Anyone who already pulled');
    expect(text).toContain('Other branches (old-feature)');
    expect(text).toContain('Tags v1');
    // origin/main still holds the old commits, so they stay in the picture next to the new ones.
    const snap = await readSnapshot(repo.dir);
    expect(plan.preview.hideCommits).toEqual([]);
    const preview = applyPreview(snap.commits, plan.preview);
    expect(preview.filter((c) => c.preview)).toHaveLength(3);
    expect(preview[0].refs).toContainEqual({ kind: 'branch', name: 'main', current: true });
  });

  it('can limit itself to unpushed commits', async () => {
    const repo = authoredRepo();
    const remote = mkdtempSync(join(tmpdir(), 'gitpicky-remote-'));
    execFileSync('git', ['init', '-q', '--bare', remote]);
    repo.git('remote', 'add', 'origin', remote);
    repo.git('push', '-q', '-u', 'origin', `${repo.a}:refs/heads/main`);
    const plan = await planChange(repo.dir, { type: 'rewrite_authors', from: 'unpushed', author: ME, onlyAuthorEmail: OLD, removeCoAuthors: true });
    expect(plan.blockers).toEqual([]);
    expect(plan.risk).toBe('careful');
    expect(plan.summary).toContain('2 commits get re-created');
    expect(plan.warnings.join(' ')).toContain('None of these commits have been pushed yet');
  });

  it('keeps merges intact', async () => {
    const repo = authoredRepo();
    repo.git('switch', '-q', '-c', 'side', repo.a);
    repo.commit('side work', 'side.txt');
    repo.git('switch', '-q', 'main');
    repo.git('merge', '-q', '--no-edit', 'side');
    repo.git('branch', '-D', 'side');
    const result = await executePlan(repo.dir, { type: 'rewrite_authors', from: repo.a, author: ME, onlyAuthorEmail: OLD });
    expect(result.ok).toBe(true);
    const parents = repo.git('log', '-1', '--format=%P', 'main').trim().split(' ');
    expect(parents).toHaveLength(2);
    expect(repo.git('log', '--format=%ae', 'main').split('\n')).not.toContain(OLD);
  });

  it('blocks when nothing would change, and on a detached HEAD', async () => {
    const repo = authoredRepo();
    const none = await planChange(repo.dir, { type: 'rewrite_authors', from: repo.a, author: ME, onlyAuthorEmail: 'nobody@example.com' });
    expect(none.blockers[0]).toContain('Nothing would change');
    repo.git('switch', '-q', '--detach', repo.b);
    const detached = await planChange(repo.dir, { type: 'rewrite_authors', from: repo.a, removeCoAuthors: true });
    expect(detached.blockers[0]).toContain('detached HEAD');
  });

  it('rejects a bad email', async () => {
    const repo = authoredRepo();
    const plan = await planChange(repo.dir, { type: 'rewrite_authors', from: repo.a, author: { name: 'X', email: 'not an email' } });
    expect(plan.blockers.join(' ')).toContain("doesn't look like an email");
  });
});
