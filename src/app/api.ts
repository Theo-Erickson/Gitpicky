// The bridge between the window (renderer) and the app's main process.
// Type-only, so both sides can import it.

import type { ProposalView } from '../core/bridge-protocol';
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
  /** Full commit message, including trailers like Co-authored-by. */
  commitMessage(hash: string): Promise<Result<string>>;
  plan(op: Operation): Promise<Result<Plan>>;
  run(op: Operation): Promise<Result<RunOutcome>>;
  openExternal(url: string): Promise<void>;
  /** Absolute path of the bundled MCP server script, for the assistant's config. */
  mcpServerPath(): Promise<string>;
  /** Changes an assistant has asked for through the MCP server. */
  proposals(): Promise<ProposalView[]>;
  approveProposal(id: string): Promise<Result<ProposalView>>;
  rejectProposal(id: string, note?: string): Promise<Result<ProposalView>>;
  onProposalsChanged(listener: () => void): () => void;
  /** Called whenever files or history change on disk. Returns an unsubscribe function. */
  onRepoChanged(listener: () => void): () => void;
}

declare global {
  interface Window {
    gitpicky: GitpickyApi;
  }
}
