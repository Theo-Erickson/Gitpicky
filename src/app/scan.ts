// Finds git repositories inside the folders you keep projects in, for the
// repository browser. Reads the file system only (no git processes), so a
// folder with hundreds of projects still lists in a moment.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

export interface FoundRepo {
  path: string;
  name: string;
  /** The scan folder it was found in. */
  root: string;
  /** Checked-out branch, or null for a detached HEAD. */
  branch: string | null;
  /** Rough "last worked on" time: when git's index or HEAD last changed (ISO). */
  lastActivity: string;
}

export interface ScanOptions {
  /** How many folder levels below each root to look. */
  maxDepth?: number;
  /** Stop after this many repositories in total. */
  limit?: number;
}

/** Folders that never hold projects, or are huge and slow to walk. */
const SKIP = new Set([
  'node_modules',
  'AppData',
  'Library',
  'Applications',
  '$RECYCLE.BIN',
  'System Volume Information',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
  'Pods',
  'DerivedData',
  'Intermediate',
  'Binaries',
  'Saved',
]);

/** Places people commonly keep repositories. Only the ones that exist are suggested. */
export function suggestedRoots(home = homedir()): string[] {
  const candidates = [
    join(home, 'Documents', 'GitHub'),
    join(home, 'GitHub'),
    join(home, 'source', 'repos'),
    join(home, 'repos'),
    join(home, 'Projects'),
    join(home, 'projects'),
    join(home, 'dev'),
    join(home, 'Developer'),
    join(home, 'code'),
    join(home, 'Code'),
    join(home, 'src'),
  ];
  const seen = new Set<string>();
  return candidates.filter((p) => {
    const key = p.toLowerCase();
    if (seen.has(key) || !isDir(p)) return false;
    seen.add(key);
    return true;
  });
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Branch and last-activity time, read straight from the .git folder. */
export function readRepoInfo(path: string): { branch: string | null; lastActivity: string } {
  const gitDir = join(path, '.git');
  let dir = gitDir;
  try {
    // Worktrees and submodules have a .git *file* pointing at the real folder.
    if (statSync(gitDir).isFile()) {
      const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(gitDir, 'utf8'));
      if (m) dir = m[1].trim().startsWith('.') ? join(path, m[1].trim()) : m[1].trim();
    }
  } catch {
    // fall through with the default
  }
  let branch: string | null = null;
  try {
    const head = readFileSync(join(dir, 'HEAD'), 'utf8').trim();
    branch = head.startsWith('ref: refs/heads/') ? head.slice('ref: refs/heads/'.length) : null;
  } catch {
    branch = null;
  }
  let time = 0;
  for (const f of ['index', 'HEAD', 'FETCH_HEAD']) {
    try {
      time = Math.max(time, statSync(join(dir, f)).mtimeMs);
    } catch {
      // not every repo has every file
    }
  }
  return { branch, lastActivity: time ? new Date(time).toISOString() : '' };
}

/** Walks each root and returns the repositories found, most recently active first. */
export async function scanForRepos(roots: string[], options: ScanOptions = {}): Promise<FoundRepo[]> {
  const maxDepth = options.maxDepth ?? 3;
  const limit = options.limit ?? 600;
  const found: FoundRepo[] = [];
  const seen = new Set<string>();

  async function walk(dir: string, root: string, depth: number): Promise<void> {
    if (found.length >= limit) return;
    if (existsSync(join(dir, '.git'))) {
      const key = dir.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        found.push({ path: dir, name: basename(dir), root, ...readRepoInfo(dir) });
      }
      return; // don't look for repos inside repos
    }
    if (depth >= maxDepth) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // no permission, or it vanished
    }
    const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name));
    await Promise.all(dirs.map((e) => walk(join(dir, e.name), root, depth + 1)));
  }

  for (const root of roots) {
    if (isDir(root)) await walk(root, root, 0);
  }
  return found.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
}
