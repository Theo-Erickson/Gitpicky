import { z } from 'zod';
import type { Operation } from '../core/preview';

const branchName = z.string().min(1).describe('Branch name, e.g. "fix-jump-height" or "art/new-sprites". No spaces.');
const rev = z.string().min(1).describe('A commit hash (short is fine), branch name or tag.');

/** Every change the assistant can ask for. Mirrors the Operation type in src/core/preview.ts. */
export const operationSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('create_branch'),
      name: branchName,
      from: rev.optional().describe('Where the branch starts. Defaults to the current commit (HEAD).'),
      switchTo: z.boolean().optional().describe('Move onto the new branch right away. Default true.'),
    })
    .describe('Make a new branch.'),
  z.object({ type: z.literal('switch_branch'), name: z.string().min(1).describe('Branch to switch to. A remote branch like "origin/feature" makes a local copy. A commit hash enters detached HEAD.') }).describe('Switch to another branch or commit.'),
  z
    .object({
      type: z.literal('commit'),
      message: z.string().min(1).describe('Commit message: a short summary of what changed and why.'),
      files: z.array(z.string()).optional().describe('Exact paths (as shown by get_repo_overview) to include. Omit to commit staged files, or every change if nothing is staged.'),
    })
    .describe('Save changes as a new commit.'),
  z
    .object({
      type: z.literal('undo_last_commit'),
      keepChanges: z.enum(['staged', 'unstaged']).optional().describe('Leave the undone changes staged (default) or as unstaged edits.'),
    })
    .describe('Take back the most recent commit but keep its changes in the files.'),
  z
    .object({
      type: z.literal('merge'),
      branch: rev.describe('Branch to bring into the current branch.'),
      noFastForward: z.boolean().optional().describe('Always create a merge commit, even when a fast-forward is possible.'),
    })
    .describe('Merge another branch into the current one.'),
  z.object({ type: z.literal('revert'), commit: rev }).describe('Add a new commit that undoes an earlier one (safe for shared history).'),
  z.object({ type: z.literal('cherry_pick'), commit: rev }).describe('Copy one commit onto the current branch.'),
  z
    .object({
      type: z.literal('reset'),
      to: rev,
      mode: z.enum(['soft', 'mixed', 'hard']).describe('soft = keep changes staged, mixed = keep as edits, hard = throw them away.'),
    })
    .describe('Move the current branch to another commit. Prefer revert or undo_last_commit when possible.'),
  z
    .object({
      type: z.literal('discard_changes'),
      files: z.array(z.string()).optional().describe('Paths to discard. Omit for all uncommitted changes.'),
    })
    .describe('Throw away uncommitted edits. Cannot be undone; prefer stash.'),
  z
    .object({
      type: z.literal('stash'),
      message: z.string().optional(),
      includeUntracked: z.boolean().optional().describe('Also stash new files. Default true.'),
    })
    .describe('Set uncommitted changes aside.'),
  z.object({ type: z.literal('stash_pop') }).describe('Bring back the most recently stashed changes.'),
  z
    .object({
      type: z.literal('create_tag'),
      name: z.string().min(1).describe('Tag name, e.g. "v1.0.0".'),
      commit: rev.optional().describe('Defaults to HEAD.'),
      message: z.string().optional().describe('Makes an annotated tag with this note.'),
    })
    .describe('Pin a permanent label (often a version) on a commit.'),
  z
    .object({
      type: z.literal('delete_branch'),
      name: branchName,
      force: z.boolean().optional().describe('Required to delete a branch whose commits are not merged.'),
    })
    .describe('Delete a local branch.'),
  z
    .object({
      type: z.literal('rename_branch'),
      name: z.string().optional().describe('Branch to rename. Defaults to the current branch.'),
      newName: branchName,
    })
    .describe('Rename a branch.'),
  z.object({ type: z.literal('fetch'), remote: z.string().optional() }).describe('Download new commits from the remote without changing local branches.'),
  z.object({ type: z.literal('pull') }).describe('Fetch and merge the remote branch into the current branch.'),
  z.object({ type: z.literal('push'), setUpstream: z.boolean().optional() }).describe('Upload commits to the remote. Never forces.'),
  z.object({ type: z.literal('abort') }).describe('Cancel an in-progress merge, rebase, cherry-pick or revert.'),
]);

// Compile-time check that the schema and the core Operation type stay in sync.
type SchemaOperation = z.infer<typeof operationSchema>;
const _toCore = (op: SchemaOperation): Operation => op;
const _fromCore = (op: Operation): SchemaOperation => op;
void _toCore;
void _fromCore;
