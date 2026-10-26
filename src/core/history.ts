import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { gitDir, runGit } from './git';
import type { Commit, FileChange, FileChangeKind, Ref, RepoSnapshot, RepoStatus } from './types';

const FIELD = '\x1f';
const RECORD = '\x1e';
export const LOG_FORMAT = ['%H', '%P', '%an', '%ae', '%aI', '%s', '%D'].join('%x1f') + '%x1e';

/** Parses one `%D` decoration string ("HEAD -> main, origin/main, tag: v1"). */
export function parseDecorations(decorations: string, remotes: string[]): Ref[] {
  const refs: Ref[] = [];
  for (const raw of decorations.split(', ').map((s) => s.trim()).filter(Boolean)) {
    if (raw.startsWith('HEAD -> ')) {
      refs.push({ kind: 'head', name: 'HEAD' });
      refs.push({ kind: 'branch', name: raw.slice('HEAD -> '.length), current: true });
    } else if (raw === 'HEAD') {
      refs.push({ kind: 'head', name: 'HEAD' });
    } else if (raw.startsWith('tag: ')) {
      refs.push({ kind: 'tag', name: raw.slice('tag: '.length) });
    } else if (remotes.some((r) => raw.startsWith(`${r}/`))) {
      // "origin/HEAD" is just a pointer to the remote's default branch; it adds noise for beginners.
      if (!raw.endsWith('/HEAD')) refs.push({ kind: 'remote', name: raw });
    } else if (raw.startsWith('refs/')) {
      // Unusual refs (e.g. refs/stash) are left out of the picture.
      continue;
    } else {
      refs.push({ kind: 'branch', name: raw });
    }
  }
  return refs;
}

export function parseLog(output: string, remotes: string[]): Commit[] {
  const commits: Commit[] = [];
  for (const record of output.split(RECORD)) {
    const line = record.replace(/^\s+/, '');
    if (!line) continue;
    const [hash, parents, authorName, authorEmail, date, subject, decorations] = line.split(FIELD);
    if (!hash) continue;
    commits.push({
      hash,
      shortHash: hash.slice(0, 7),
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      authorName: authorName ?? '',
      authorEmail: authorEmail ?? '',
      date: date ?? '',
      subject: subject ?? '',
      refs: parseDecorations(decorations ?? '', remotes),
    });
  }
  return commits;
}

function changeKind(code: string): FileChangeKind {
  switch (code) {
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case 'T':
      return 'type-changed';
    default:
      return 'modified';
  }
}

/** Parses `git status --porcelain=v2 --branch -z` output. */
export function parseStatus(output: string): Omit<RepoStatus, 'inProgress'> {
  const status: Omit<RepoStatus, 'inProgress'> = {
    branch: null,
    headHash: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    changes: [],
  };
  const entries = output.split('\0');
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    if (entry.startsWith('# branch.oid ')) {
      const oid = entry.slice('# branch.oid '.length);
      status.headHash = oid === '(initial)' ? null : oid;
    } else if (entry.startsWith('# branch.head ')) {
      const head = entry.slice('# branch.head '.length);
      status.branch = head === '(detached)' ? null : head;
    } else if (entry.startsWith('# branch.upstream ')) {
      status.upstream = entry.slice('# branch.upstream '.length);
    } else if (entry.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(entry);
      if (m) {
        status.ahead = Number(m[1]);
        status.behind = Number(m[2]);
      }
    } else if (entry.startsWith('1 ') || entry.startsWith('2 ')) {
      const parts = entry.split(' ');
      const xy = parts[1] ?? '..';
      const isRename = entry.startsWith('2 ');
      // Ordinary entries have 8 fields before the path; rename entries have 9.
      const path = parts.slice(isRename ? 9 : 8).join(' ');
      const from = isRename ? entries[++i] : undefined;
      const [x, y] = [xy[0] ?? '.', xy[1] ?? '.'];
      if (x !== '.') status.changes.push({ path, from, kind: changeKind(x), staged: true });
      if (y !== '.') status.changes.push({ path, kind: changeKind(y), staged: false });
    } else if (entry.startsWith('u ')) {
      const path = entry.split(' ').slice(10).join(' ');
      status.changes.push({ path, kind: 'conflicted', staged: false });
    } else if (entry.startsWith('? ')) {
      status.changes.push({ path: entry.slice(2), kind: 'untracked', staged: false });
    }
  }
  return status;
}

async function listRefs(repo: string, namespace: string): Promise<string[]> {
  const out = await runGit(repo, ['for-each-ref', '--format=%(refname:short)', namespace]);
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

export async function readStatus(repo: string): Promise<RepoStatus> {
  const out = await runGit(repo, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']);
  const parsed = parseStatus(out);
  const dir = await gitDir(repo);
  let inProgress: RepoStatus['inProgress'] = null;
  if (existsSync(join(dir, 'rebase-merge')) || existsSync(join(dir, 'rebase-apply'))) inProgress = 'rebase';
  else if (existsSync(join(dir, 'MERGE_HEAD'))) inProgress = 'merge';
  else if (existsSync(join(dir, 'CHERRY_PICK_HEAD'))) inProgress = 'cherry-pick';
  else if (existsSync(join(dir, 'REVERT_HEAD'))) inProgress = 'revert';
  return { ...parsed, inProgress };
}

export async function readRemotes(repo: string): Promise<string[]> {
  const out = await runGit(repo, ['remote']);
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

export async function readHistory(repo: string, limit = 400, remotes?: string[]): Promise<Commit[]> {
  const knownRemotes = remotes ?? (await readRemotes(repo));
  try {
    // --all includes HEAD, so a detached HEAD still shows up.
    const out = await runGit(repo, [
      'log',
      '--exclude=refs/stash',
      '--all',
      '--topo-order',
      `--max-count=${limit}`,
      `--format=${LOG_FORMAT}`,
      '--decorate=short',
    ]);
    return parseLog(out, knownRemotes);
  } catch (error) {
    // A brand-new repository has no commits yet, which git reports as an error.
    const status = await readStatus(repo).catch(() => null);
    if (status && status.headHash === null) return [];
    throw error;
  }
}

/** Everything the UI needs to draw a repository, read in one go. */
export async function readSnapshot(repo: string, limit = 400): Promise<RepoSnapshot> {
  const remotes = await readRemotes(repo);
  const [status, commits, branches, tags] = await Promise.all([
    readStatus(repo),
    readHistory(repo, limit + 1, remotes),
    listRefs(repo, 'refs/heads'),
    listRefs(repo, 'refs/tags'),
  ]);
  return {
    path: repo,
    name: basename(repo),
    status,
    commits: commits.slice(0, limit),
    branches,
    remotes,
    tags,
    truncated: commits.length > limit,
  };
}

/** Files touched by one commit, for the details panel. */
export async function readCommitFiles(repo: string, hash: string): Promise<FileChange[]> {
  const out = await runGit(repo, ['show', '--format=', '--name-status', '-M', '-z', hash]);
  const parts = out.split('\0').filter((p) => p !== '');
  const files: FileChange[] = [];
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i].trim();
    const letter = code[0];
    if (letter === 'R' || letter === 'C') {
      const from = parts[++i];
      const path = parts[++i];
      files.push({ path, from, kind: changeKind(letter), staged: true });
    } else {
      files.push({ path: parts[++i], kind: changeKind(letter), staged: true });
    }
  }
  return files;
}
