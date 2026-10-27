// Rewriting who a commit is credited to: change the author and/or remove
// "Co-authored-by:" lines on a run of commits.
//
// Git commits can't be edited in place: changing anything gives a commit a new
// ID, and every commit after it must be re-created too (each one records its
// parent's ID). Gitpicky does this directly with git's object commands, which
// keeps the files, dates and merge structure exactly as they were. The working
// folder is never touched.

import { runGit } from './git';

export interface Identity {
  name: string;
  email: string;
}

export interface RewriteOptions {
  /** Oldest commit to include, or "unpushed". */
  from: string;
  author?: Identity;
  onlyAuthorEmail?: string;
  removeCoAuthors?: boolean;
}

export interface RewrittenCommit {
  hash: string;
  subject: string;
  oldAuthor: Identity;
  /** Author after the rewrite. */
  newAuthor: Identity;
  /** Co-author lines that will be removed. */
  removedCoAuthors: string[];
  /** True when the author or message changes (not just the parent ID). */
  edited: boolean;
  signed: boolean;
  parents: string[];
}

export interface RewriteAnalysis {
  branch: string;
  head: string;
  /** Commits in the range, oldest first. */
  commits: RewrittenCommit[];
  /** Range commits already on a remote. */
  pushed: string[];
  /** Remote branches that contain some of the range. */
  remoteBranches: string[];
  /** Other local branches that contain some of the range. */
  otherBranches: string[];
  /** Tags pointing at commits in the range. */
  tags: string[];
  /** Commits in the range that will drop out of view (no other label keeps them). */
  orphaned: string[];
  /** Reasons it can't run, if any. */
  problems: string[];
}

const IDENTITY_LINE = /^(author|committer) (.*) <([^>]*)> (\d+ [+-]\d{4})$/;
const CO_AUTHOR_LINE = /^[ \t]*co-authored-by:[ \t]*(.*?)[ \t]*$/i;
export const MAX_REWRITE = 5000;

export function isValidEmail(email: string): boolean {
  return /^[^\s<>@]+@[^\s<>@]+$/.test(email);
}

interface ParsedCommit {
  headers: string[];
  message: string;
}

/** Splits a raw commit object into header lines (continuations kept with their header) and message. */
export function parseRawCommit(raw: string): ParsedCommit {
  const split = raw.indexOf('\n\n');
  const head = split === -1 ? raw : raw.slice(0, split);
  const message = split === -1 ? '' : raw.slice(split + 2);
  const headers: string[] = [];
  for (const line of head.split('\n')) {
    if (line.startsWith(' ') && headers.length) headers[headers.length - 1] += `\n${line}`;
    else if (line) headers.push(line);
  }
  return { headers, message };
}

export function readIdentity(header: string): Identity | null {
  const m = IDENTITY_LINE.exec(header);
  return m ? { name: m[2], email: m[3] } : null;
}

export function coAuthorsIn(message: string): string[] {
  return message
    .split('\n')
    .map((l) => CO_AUTHOR_LINE.exec(l)?.[1])
    .filter((v): v is string => !!v);
}

export function stripCoAuthors(message: string): string {
  const kept = message.split('\n').filter((l) => !CO_AUTHOR_LINE.test(l));
  while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();
  return kept.join('\n') + '\n';
}

function sameIdentity(a: Identity, b: Identity): boolean {
  return a.name === b.name && a.email.toLowerCase() === b.email.toLowerCase();
}

function wantsNewAuthor(current: Identity, opts: RewriteOptions): boolean {
  if (!opts.author) return false;
  if (opts.onlyAuthorEmail && current.email.toLowerCase() !== opts.onlyAuthorEmail.toLowerCase()) return false;
  return !sameIdentity(current, opts.author);
}

/**
 * Builds the new raw commit. `parentMap` maps old parent IDs to their rewritten IDs.
 * Signatures are dropped whenever anything changes, because they would no longer be valid.
 */
export function rewriteRaw(raw: string, opts: RewriteOptions, parentMap: Map<string, string>): string {
  const { headers, message } = parseRawCommit(raw);
  const authorHeader = headers.find((h) => h.startsWith('author ')) ?? '';
  const author = readIdentity(authorHeader);
  const changeAuthor = !!author && wantsNewAuthor(author, opts);
  const out: string[] = [];
  for (const header of headers) {
    if (header.startsWith('gpgsig ') || header.startsWith('gpgsig-sha256 ')) continue;
    if (header.startsWith('parent ')) {
      const old = header.slice(7);
      out.push(`parent ${parentMap.get(old) ?? old}`);
    } else if (changeAuthor && (header.startsWith('author ') || header.startsWith('committer '))) {
      const m = IDENTITY_LINE.exec(header);
      out.push(m ? `${m[1]} ${opts.author!.name} <${opts.author!.email}> ${m[4]}` : header);
    } else {
      out.push(header);
    }
  }
  const newMessage = opts.removeCoAuthors && coAuthorsIn(message).length ? stripCoAuthors(message) : message;
  return `${out.join('\n')}\n\n${newMessage}`;
}

async function lines(repo: string, args: string[]): Promise<string[]> {
  const out = await runGit(repo, args);
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

/** The commit IDs a rewrite starting at `from` would touch, oldest first. */
async function rangeArgs(repo: string, from: string): Promise<string[]> {
  if (from === 'unpushed') return ['HEAD', '--not', '--remotes'];
  // Everything after the parents of `from` (all of them, so merges work), up to HEAD.
  const parents = (await runGit(repo, ['rev-list', '--parents', '-n', '1', from])).trim().split(' ').slice(1);
  return ['HEAD', ...(parents.length ? ['--not', ...parents] : [])];
}

/** Works out exactly what a rewrite would do, without changing anything. */
export async function analyzeRewrite(repo: string, opts: RewriteOptions): Promise<RewriteAnalysis> {
  const problems: string[] = [];
  const analysis: RewriteAnalysis = {
    branch: '',
    head: '',
    commits: [],
    pushed: [],
    remoteBranches: [],
    otherBranches: [],
    tags: [],
    orphaned: [],
    problems,
  };

  let branch = '';
  try {
    branch = (await runGit(repo, ['symbolic-ref', '--short', '-q', 'HEAD'])).trim();
  } catch {
    branch = '';
  }
  if (!branch) {
    problems.push("You're not on a branch (detached HEAD). Switch to the branch whose commits you want to fix.");
    return analysis;
  }
  analysis.branch = branch;
  try {
    analysis.head = (await runGit(repo, ['rev-parse', '--verify', 'HEAD'])).trim();
  } catch {
    problems.push('This branch has no commits yet.');
    return analysis;
  }

  if (opts.from !== 'unpushed') {
    let from: string;
    try {
      from = (await runGit(repo, ['rev-parse', '--verify', `${opts.from}^{commit}`])).trim();
    } catch {
      problems.push(`Can't find commit "${opts.from}".`);
      return analysis;
    }
    try {
      await runGit(repo, ['merge-base', '--is-ancestor', from, 'HEAD']);
    } catch {
      problems.push(`That commit isn't part of "${branch}". Switch to the branch it belongs to first.`);
      return analysis;
    }
  }
  if (!opts.author && !opts.removeCoAuthors) problems.push('Choose a new author, removing co-authors, or both.');
  if (opts.author) {
    if (!opts.author.name.trim()) problems.push('The new author needs a name.');
    if (!isValidEmail(opts.author.email)) problems.push(`"${opts.author.email}" doesn't look like an email address.`);
  }

  const range = await rangeArgs(repo, opts.from);
  const hashes = await lines(repo, ['rev-list', '--reverse', '--topo-order', ...range]);
  if (hashes.length === 0) {
    problems.push(opts.from === 'unpushed' ? 'Every commit on this branch is already pushed; nothing is waiting to be pushed.' : 'There are no commits in that range.');
    return analysis;
  }
  if (hashes.length > MAX_REWRITE) {
    problems.push(`That's ${hashes.length} commits; Gitpicky rewrites at most ${MAX_REWRITE} at a time.`);
    return analysis;
  }

  for (const hash of hashes) {
    const raw = await runGit(repo, ['cat-file', 'commit', hash]);
    const { headers, message } = parseRawCommit(raw);
    const encoding = headers.find((h) => h.startsWith('encoding '));
    if (encoding && !/utf-?8/i.test(encoding)) {
      problems.push(`Commit ${hash.slice(0, 7)} uses a ${encoding.slice(9)} message encoding, which Gitpicky can't rewrite safely.`);
      return analysis;
    }
    const oldAuthor = readIdentity(headers.find((h) => h.startsWith('author ')) ?? '') ?? { name: '?', email: '?' };
    const changeAuthor = wantsNewAuthor(oldAuthor, opts);
    const removed = opts.removeCoAuthors ? coAuthorsIn(message) : [];
    analysis.commits.push({
      hash,
      subject: message.split('\n')[0] ?? '',
      oldAuthor,
      newAuthor: changeAuthor ? opts.author! : oldAuthor,
      removedCoAuthors: removed,
      edited: changeAuthor || removed.length > 0,
      signed: headers.some((h) => h.startsWith('gpgsig')),
      parents: headers.filter((h) => h.startsWith('parent ')).map((h) => h.slice(7)),
    });
  }

  // A commit has to be re-created if it changes itself or any of its parents is re-created.
  // The rest of the range keeps its IDs.
  const needed = new Set<string>();
  for (const c of analysis.commits) {
    if (c.edited || c.parents.some((p) => needed.has(p))) needed.add(c.hash);
  }
  if (needed.size === 0) {
    problems.push(
      opts.author && opts.onlyAuthorEmail
        ? `No commits in this range are by ${opts.onlyAuthorEmail}${opts.removeCoAuthors ? ' or have co-authors' : ''}. Nothing would change.`
        : 'Nothing would change: these commits already have that author and no co-authors.',
    );
    analysis.commits = [];
    return analysis;
  }
  analysis.commits = analysis.commits.filter((c) => needed.has(c.hash));
  const touched = analysis.commits.map((c) => c.hash);
  const touchedSet = new Set(touched);

  // Which of them are already on a remote?
  const oldest = touched[0];
  const unpushed = new Set(await lines(repo, ['rev-list', 'HEAD', '--not', '--remotes']));
  analysis.pushed = touched.filter((h) => !unpushed.has(h));
  if (analysis.pushed.length) {
    analysis.remoteBranches = await lines(repo, ['for-each-ref', '--contains', analysis.pushed[0], '--format=%(refname:short)', 'refs/remotes']);
    analysis.remoteBranches = analysis.remoteBranches.filter((r) => !r.endsWith('/HEAD'));
  }
  analysis.otherBranches = (await lines(repo, ['for-each-ref', '--contains', oldest, '--format=%(refname:short)', 'refs/heads'])).filter(
    (b) => b !== branch,
  );
  const tagLines = await lines(repo, ['for-each-ref', '--format=%(refname:short) %(*objectname) %(objectname)', 'refs/tags']);
  for (const line of tagLines) {
    const [name, peeled, direct] = line.split(' ');
    const target = peeled || direct;
    if (touchedSet.has(target)) analysis.tags.push(name);
  }
  // Old commits stay visible only if some other label still reaches them.
  const others = await lines(repo, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes', 'refs/tags']);
  const keepers = others.filter((r) => r !== `refs/heads/${branch}` && !r.endsWith('/HEAD'));
  const stillReachable = new Set(keepers.length ? await lines(repo, ['rev-list', ...keepers]) : []);
  analysis.orphaned = touched.filter((h) => !stillReachable.has(h));
  return analysis;
}

export interface RewriteResult {
  oldHead: string;
  newHead: string;
  backupRef: string;
  rewritten: number;
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Performs the rewrite. Call analyzeRewrite first; this re-checks and refuses if anything is off. */
export async function rewriteAuthors(repo: string, opts: RewriteOptions): Promise<RewriteResult> {
  const analysis = await analyzeRewrite(repo, opts);
  if (analysis.problems.length) throw new Error(analysis.problems.join(' '));
  const map = new Map<string, string>();
  for (const commit of analysis.commits) {
    const raw = await runGit(repo, ['cat-file', 'commit', commit.hash]);
    const next = rewriteRaw(raw, opts, map);
    const id = (await runGit(repo, ['hash-object', '-t', 'commit', '-w', '--stdin'], { input: next })).trim();
    map.set(commit.hash, id);
  }
  const newHead = map.get(analysis.head) ?? analysis.head;
  const backupRef = `refs/gitpicky/backup/${analysis.branch}/${timestamp()}`;
  await runGit(repo, ['update-ref', '-m', 'gitpicky: backup before rewriting authors', backupRef, analysis.head]);
  // The old value guards against the branch having moved since we looked.
  await runGit(repo, ['update-ref', '-m', 'gitpicky: rewrite authors', `refs/heads/${analysis.branch}`, newHead, analysis.head]);
  return { oldHead: analysis.head, newHead, backupRef, rewritten: map.size };
}
