import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { runGit } from '../core/git';
import type { RecentRepo } from './api';
import type { RecentEntry } from './settings';

async function currentBranch(path: string): Promise<string | null> {
  try {
    const out = await runGit(path, ['symbolic-ref', '--short', '-q', 'HEAD'], { timeoutMs: 3000 });
    return out.trim() || null;
  } catch {
    return null;
  }
}

/** Adds what the picker shows for each remembered repo: its name, current branch, and whether it still exists. */
export async function describeRecent(entries: RecentEntry[], current: string | null): Promise<RecentRepo[]> {
  return Promise.all(
    entries.map(async (e) => {
      const exists = existsSync(join(e.path, '.git'));
      return {
        path: e.path,
        name: basename(e.path) || e.path,
        lastOpened: e.lastOpened,
        exists,
        branch: exists ? await currentBranch(e.path) : null,
        current: current !== null && e.path === current,
      };
    }),
  );
}
