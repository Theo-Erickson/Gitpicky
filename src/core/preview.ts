// Plan and preview shapes plus the pure helpers that work on them. No Node
// imports here, so the desktop UI can use this file directly.

import type { Commit } from './types';

export type Operation =
  | { type: 'create_branch'; name: string; from?: string; switchTo?: boolean }
  | { type: 'switch_branch'; name: string }
  | { type: 'commit'; message: string; files?: string[] }
  | { type: 'undo_last_commit'; keepChanges?: 'staged' | 'unstaged' }
  | { type: 'merge'; branch: string; noFastForward?: boolean }
  | { type: 'revert'; commit: string }
  | { type: 'cherry_pick'; commit: string }
  | { type: 'reset'; to: string; mode: 'soft' | 'mixed' | 'hard' }
  | { type: 'discard_changes'; files?: string[] }
  | { type: 'stash'; message?: string; includeUntracked?: boolean }
  | { type: 'stash_pop' }
  | { type: 'create_tag'; name: string; commit?: string; message?: string }
  | { type: 'delete_branch'; name: string; force?: boolean }
  | { type: 'rename_branch'; name?: string; newName: string }
  | { type: 'fetch'; remote?: string }
  | { type: 'pull' }
  | { type: 'push'; setUpstream?: boolean }
  | { type: 'abort' };

export type OperationType = Operation['type'];

export type Risk = 'safe' | 'careful' | 'destructive';

export interface PlanStep {
  /** Arguments after "git". */
  args: string[];
  /** Why this step is needed, in plain words. */
  why: string;
}

export interface PreviewCommit {
  id: string;
  parents: string[];
  subject: string;
}

export interface PreviewEffect {
  /** Commits that will be created (drawn as ghost dots). */
  newCommits: PreviewCommit[];
  /** Labels that will move. `to` is a commit hash or a PreviewCommit id. */
  moveRefs: { kind: 'branch' | 'tag' | 'remote'; name: string; to: string }[];
  /** Labels that will disappear. */
  removeRefs: { kind: 'branch' | 'tag' | 'remote'; name: string }[];
  /** Where HEAD will be afterwards (branch name or commit), if it changes. */
  head?: { branch: string | null; at: string };
}

export interface Plan {
  operation: Operation;
  title: string;
  /** What will happen, for someone who doesn't know git. */
  summary: string;
  steps: PlanStep[];
  risk: Risk;
  /** Things worth knowing before approving. */
  warnings: string[];
  /** Reasons the plan can't run right now. Empty when it can. */
  blockers: string[];
  preview: PreviewEffect;
  /** Glossary ids worth reading. */
  learn: string[];
}

/**
 * Returns a copy of the history with a plan's predicted result drawn in:
 * ghost commits on top and labels moved to where they will end up.
 */
export function applyPreview(commits: Commit[], effect: PreviewEffect): Commit[] {
  const ghosts: Commit[] = effect.newCommits
    .slice()
    .reverse()
    .map((p) => ({
      hash: p.id,
      shortHash: 'new',
      parents: p.parents,
      authorName: '',
      authorEmail: '',
      date: '',
      subject: p.subject,
      refs: [],
      preview: true,
    }));
  const all = [...ghosts, ...commits.map((c) => ({ ...c, refs: c.refs.slice() }))];
  const removeRef = (kind: string, name: string) => {
    for (const c of all) c.refs = c.refs.filter((r) => !(r.kind === kind && r.name === name));
  };
  for (const r of effect.removeRefs) removeRef(r.kind, r.name);
  for (const m of effect.moveRefs) {
    removeRef(m.kind, m.name);
    all.find((c) => c.hash === m.to)?.refs.push({ kind: m.kind, name: m.name });
  }
  if (effect.head) {
    for (const c of all) {
      c.refs = c.refs.filter((r) => r.kind !== 'head').map((r) => (r.current ? { ...r, current: false } : r));
    }
    const target = all.find((c) => c.hash === effect.head!.at);
    if (target) {
      target.refs.unshift({ kind: 'head', name: 'HEAD' });
      const branch = effect.head.branch;
      if (branch) {
        const ref = target.refs.find((r) => r.kind === 'branch' && r.name === branch);
        if (ref) ref.current = true;
        else target.refs.push({ kind: 'branch', name: branch, current: true });
      }
    }
  }
  return all;
}

export function formatCommand(args: string[]): string {
  return ['git', ...args.map((a) => (/[\s"'$`]/.test(a) ? JSON.stringify(a) : a))].join(' ');
}
