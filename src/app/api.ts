// The bridge between the window (renderer) and the app's main process.
// Type-only, so both sides can import it.

import type { FileChange, RepoSnapshot } from '../core/types';
import type { Operation, Plan } from '../core/preview';

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export interface RunOutcome {
  ok: boolean;
  error?: string;
  log: { command: string; output: string }[];
  plan: Plan;
}

export interface GitpickyApi {
  /** Shows a folder picker and opens the chosen repository. */
  pickRepo(): Promise<Result<RepoSnapshot> | null>;
  openRepo(path: string): Promise<Result<RepoSnapshot>>;
  /** Re-reads the open repository. */
  refresh(): Promise<Result<RepoSnapshot> | null>;
  recentRepos(): Promise<string[]>;
  commitFiles(hash: string): Promise<Result<FileChange[]>>;
  plan(op: Operation): Promise<Result<Plan>>;
  run(op: Operation): Promise<Result<RunOutcome>>;
  openExternal(url: string): Promise<void>;
  /** Called whenever files or history change on disk. Returns an unsubscribe function. */
  onRepoChanged(listener: () => void): () => void;
}

declare global {
  interface Window {
    gitpicky: GitpickyApi;
  }
}
