import { watch, type FSWatcher } from 'node:fs';
import { sep } from 'node:path';

const NOISY = [`${sep}.git${sep}objects`, `${sep}node_modules${sep}`];

/**
 * Changes that never matter on their own: lock files git creates and deletes
 * while it works, and the event for the .git folder itself (which fires whenever
 * anything inside it is created or removed). The real change that follows, like
 * a ref or the index being rewritten, is still seen. Exported for tests.
 */
export function isNoise(file: string): boolean {
  const name = `${sep}${file}`;
  if (NOISY.some((n) => name.includes(n))) return true;
  if (name.endsWith('.lock') && name.includes(`${sep}.git${sep}`)) return true;
  return name === `${sep}.git` || name.endsWith(`${sep}.git`);
}

/**
 * Watches a repository (its files and its .git folder) and calls `onChange`
 * once things settle, so the picture stays current while you work elsewhere.
 */
export class RepoWatcher {
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly onChange: () => void,
    private readonly delayMs = 350,
  ) {}

  start(repo: string): void {
    this.stop();
    try {
      this.watcher = watch(repo, { recursive: true }, (_event, file) => {
        if (file && isNoise(file.toString())) return;
        this.schedule();
      });
      this.watcher.on('error', () => this.stop());
    } catch {
      // Recursive watching isn't available everywhere; the app also refreshes on focus.
      this.watcher = null;
    }
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.onChange();
    }, this.delayMs);
  }
}
