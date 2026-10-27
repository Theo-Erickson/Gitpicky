// The bridge between the window (renderer) and the app's main process.
// Type-only, so both sides can import it.

import type { ProposalView } from '../core/bridge-protocol';
import type { FileChange, RepoSnapshot } from '../core/types';
import type { Operation, Plan } from '../core/preview';

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** A repository from the recent list, as the picker shows it. */
export interface RecentRepo {
  path: string;
  name: string;
  /** Checked-out branch, or null if detached or unreadable. */
  branch: string | null;
  /** False when the folder (or its .git) is gone. */
  exists: boolean;
  /** ISO time it was last opened ('' if unknown). */
  lastOpened: string;
  /** True for the repository open right now. */
  current: boolean;
}

/** A repository found by scanning your project folders. */
export interface BrowseRepo {
  path: string;
  name: string;
  /** The scanned folder it was found in. */
  root: string;
  branch: string | null;
  /** Rough "last worked on" time (ISO), '' if unknown. */
  lastActivity: string;
  /** In the recent list. */
  recent: boolean;
  /** Open right now. */
  current: boolean;
}

export interface BrowseResult {
  /** The folders scanned, in order. */
  roots: string[];
  repos: BrowseRepo[];
  /** True when the folder list is the automatic suggestion (you haven't changed it). */
  suggested: boolean;
}

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
  /** Recently opened repositories, most recent first. */
  recentRepos(): Promise<RecentRepo[]>;
  /** Removes a repository from the recent list (the folder itself is untouched). */
  forgetRepo(path: string): Promise<RecentRepo[]>;
  /** Scans your project folders for repositories. */
  browseRepos(): Promise<BrowseResult>;
  /** Asks for a folder to add to the scan list. Null if cancelled. */
  addScanFolder(): Promise<BrowseResult | null>;
  removeScanFolder(path: string): Promise<BrowseResult>;
  /** The real path of a file or folder dropped on the window. */
  pathForFile(file: File): string;
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
