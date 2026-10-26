// Shared data shapes. Kept dependency-free so the renderer can import them too.

export type RefKind = 'head' | 'branch' | 'remote' | 'tag';

export interface Ref {
  kind: RefKind;
  /** Display name, e.g. "main", "origin/main", "v1.0", "HEAD". */
  name: string;
  /** True for the branch HEAD currently points at ("HEAD -> main"). */
  current?: boolean;
}

export interface Commit {
  hash: string;
  shortHash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  /** ISO 8601 author date. */
  date: string;
  subject: string;
  refs: Ref[];
  /** Set on commits that only exist in a preview (not yet real). */
  preview?: boolean;
}

export type FileChangeKind =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflicted'
  | 'type-changed';

export interface FileChange {
  path: string;
  /** Previous path for renames/copies. */
  from?: string;
  kind: FileChangeKind;
  /** Change is in the staging area (index), ready to be committed. */
  staged: boolean;
}

export interface RepoStatus {
  /** Current branch name, or null when HEAD is detached. */
  branch: string | null;
  /** Commit HEAD points at, or null in a brand-new repo with no commits. */
  headHash: string | null;
  /** Remote-tracking branch this branch follows, e.g. "origin/main". */
  upstream: string | null;
  ahead: number;
  behind: number;
  changes: FileChange[];
  /** An operation git is in the middle of (needs finishing or aborting). */
  inProgress: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null;
}

export interface RepoSnapshot {
  path: string;
  name: string;
  status: RepoStatus;
  commits: Commit[];
  branches: string[];
  remotes: string[];
  tags: string[];
  /** True when the history was cut off at the requested limit. */
  truncated: boolean;
}
