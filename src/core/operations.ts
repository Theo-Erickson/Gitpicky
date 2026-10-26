// Every change Gitpicky can make, described first as a "plan": what will happen
// in plain English, the exact git commands, how risky it is, and how the picture
// will change. Nothing runs until a plan is approved.

import { execFile } from 'node:child_process';
import { GitError, runGit } from './git';
import { readSnapshot } from './history';
import type { RepoSnapshot } from './types';
import { formatCommand, type Operation, type Plan, type PreviewEffect } from './preview';

export * from './preview';

const emptyPreview = (): PreviewEffect => ({ newCommits: [], moveRefs: [], removeRefs: [] });

/** Resolves a branch, tag or hash to a full commit hash, or null. */
export async function resolveCommit(repo: string, rev: string): Promise<string | null> {
  try {
    const out = await runGit(repo, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
    return out.trim() || null;
  } catch {
    return null;
  }
}

async function isAncestor(repo: string, a: string, b: string): Promise<boolean> {
  try {
    await runGit(repo, ['merge-base', '--is-ancestor', a, b]);
    return true;
  } catch {
    return false;
  }
}

async function isValidRefName(repo: string, name: string, kind: 'branch' | 'tag'): Promise<boolean> {
  try {
    await runGit(repo, ['check-ref-format', kind === 'branch' ? '--branch' : '--normalize', kind === 'branch' ? name : `refs/tags/${name}`]);
    return !name.startsWith('-');
  } catch {
    return false;
  }
}

/** Lists files that merging `theirs` into `ours` would conflict on (needs git 2.38+; null if unknown). */
async function conflictedFiles(repo: string, ours: string, theirs: string): Promise<string[] | null> {
  return new Promise((resolve) => {
    // merge-tree prints conflicted paths on stdout but exits with 1, so read stdout ourselves.
    execFile(
      'git',
      ['merge-tree', '--write-tree', '--name-only', '--no-messages', ours, theirs],
      { cwd: repo, windowsHide: true },
      (error, stdout) => {
        if (!error) return resolve([]);
        if ((error as { code?: unknown }).code === 1) {
          return resolve(stdout.split('\n').slice(1).map((s) => s.trim()).filter(Boolean));
        }
        resolve(null);
      },
    );
  });
}

function shortName(snapshot: RepoSnapshot, hash: string): string {
  const c = snapshot.commits.find((x) => x.hash === hash);
  return c ? `${c.shortHash} "${c.subject}"` : hash.slice(0, 7);
}

function changedCount(snapshot: RepoSnapshot): number {
  return new Set(snapshot.status.changes.map((c) => c.path)).size;
}

/** Builds a plan for an operation against the repository's current state. Never changes anything. */
export async function planChange(repo: string, op: Operation, snapshotIn?: RepoSnapshot): Promise<Plan> {
  const snapshot = snapshotIn ?? (await readSnapshot(repo, 400));
  const { status } = snapshot;
  const head = status.headHash;
  const current = status.branch;
  const dirty = status.changes.length > 0;
  const trackedDirty = status.changes.some((c) => c.kind !== 'untracked');
  const plan: Plan = {
    operation: op,
    title: '',
    summary: '',
    steps: [],
    risk: 'safe',
    warnings: [],
    blockers: [],
    preview: emptyPreview(),
    learn: [],
  };
  const block = (msg: string) => plan.blockers.push(msg);
  const warn = (msg: string) => plan.warnings.push(msg);

  if (status.inProgress && op.type !== 'abort' && op.type !== 'commit') {
    block(
      `A ${status.inProgress} is in progress. Finish it (resolve conflicts, then commit) or abort it before doing anything else.`,
    );
  }

  switch (op.type) {
    case 'create_branch': {
      plan.title = `Create branch "${op.name}"`;
      plan.learn = ['branch', 'checkout'];
      if (!(await isValidRefName(repo, op.name, 'branch'))) block(`"${op.name}" isn't a valid branch name. Use letters, numbers, dashes and slashes, without spaces.`);
      if (snapshot.branches.includes(op.name)) block(`A branch called "${op.name}" already exists.`);
      const from = op.from ?? 'HEAD';
      const fromHash = await resolveCommit(repo, from);
      if (!fromHash) block(op.from ? `Can't find "${op.from}" to start the branch from.` : 'This repository has no commits yet, so there is nothing to branch from. Make a first commit.');
      const switchTo = op.switchTo ?? true;
      plan.summary =
        `Adds a new label "${op.name}" pointing at ${fromHash ? shortName(snapshot, fromHash) : from}. ` +
        (switchTo
          ? `Then you'll be "on" ${op.name}, so new commits go there and ${current ?? 'the current branch'} stays untouched.`
          : `You stay where you are; nothing about your files changes.`) +
        ' No files are copied and nothing is lost.';
      plan.steps.push(
        switchTo
          ? { args: ['switch', '-c', op.name, ...(op.from ? [op.from] : [])], why: 'Create the branch and move onto it.' }
          : { args: ['branch', op.name, ...(op.from ? [op.from] : [])], why: 'Create the branch label without moving onto it.' },
      );
      if (fromHash) {
        plan.preview.moveRefs.push({ kind: 'branch', name: op.name, to: fromHash });
        if (switchTo) plan.preview.head = { branch: op.name, at: fromHash };
      }
      if (switchTo && op.from && trackedDirty) warn('You have uncommitted edits; git will carry them over to the new branch if it can, or refuse if they would be overwritten.');
      break;
    }

    case 'switch_branch': {
      plan.title = `Switch to "${op.name}"`;
      plan.learn = ['checkout', 'head', 'detached-head'];
      const isBranch = snapshot.branches.includes(op.name);
      const remoteMatch = snapshot.remotes.find((r) => op.name.startsWith(`${r}/`));
      const target = await resolveCommit(repo, op.name);
      if (!target) block(`Can't find a branch or commit called "${op.name}".`);
      if (current === op.name) block(`You're already on "${op.name}".`);
      if (trackedDirty) {
        plan.risk = 'careful';
        warn('You have uncommitted edits. Git will bring them along if they don\'t clash, or refuse to switch if they would be overwritten. Committing or stashing first is safest.');
      }
      if (isBranch) {
        plan.summary = `Moves you onto the "${op.name}" branch. The files in your folder will change to match its latest commit${target ? `, ${shortName(snapshot, target)}` : ''}.`;
        plan.steps.push({ args: ['switch', op.name], why: 'Move HEAD to the branch and update your files.' });
        if (target) plan.preview.head = { branch: op.name, at: target };
      } else if (remoteMatch) {
        const local = op.name.slice(remoteMatch.length + 1);
        plan.summary = `Creates a local branch "${local}" that follows ${op.name}, and moves you onto it.`;
        if (snapshot.branches.includes(local)) block(`A local branch "${local}" already exists; switch to it instead.`);
        plan.steps.push({ args: ['switch', '--track', op.name], why: 'Make a local copy of the remote branch that stays linked to it.' });
        if (target) {
          plan.preview.moveRefs.push({ kind: 'branch', name: local, to: target });
          plan.preview.head = { branch: local, at: target };
        }
      } else {
        plan.risk = 'careful';
        plan.summary = `Looks at commit ${target ? shortName(snapshot, target) : op.name} directly. You'll be in "detached HEAD" mode: fine for looking around, but create a branch before making commits you want to keep.`;
        plan.steps.push({ args: ['switch', '--detach', op.name], why: 'Move HEAD to that exact commit, not to a branch.' });
        if (target) plan.preview.head = { branch: null, at: target };
      }
      break;
    }

    case 'commit': {
      plan.title = 'Commit changes';
      plan.learn = ['commit', 'staging-area'];
      const message = op.message.trim();
      if (!message) block('A commit needs a message describing what changed.');
      const staged = status.changes.filter((c) => c.staged);
      if (op.files && op.files.length > 0) {
        const known = new Set(status.changes.map((c) => c.path));
        const unknown = op.files.filter((f) => !known.has(f));
        if (unknown.length) block(`These files have no changes to commit: ${unknown.join(', ')}`);
        plan.steps.push({ args: ['add', '--', ...op.files], why: 'Stage exactly the files you picked.' });
        plan.summary = `Saves a snapshot of ${op.files.length} file${op.files.length === 1 ? '' : 's'} (${op.files.join(', ')})${staged.length ? ' plus anything already staged' : ''} with the message "${message}".`;
      } else if (staged.length > 0) {
        plan.summary = `Saves a snapshot of the ${staged.length} staged change${staged.length === 1 ? '' : 's'} with the message "${message}". Unstaged edits stay as they are.`;
      } else {
        if (!dirty) block('There are no changes to commit.');
        plan.steps.push({ args: ['add', '--all'], why: 'Stage every change, including new and deleted files.' });
        plan.summary = `Saves a snapshot of all ${changedCount(snapshot)} changed file${changedCount(snapshot) === 1 ? '' : 's'} with the message "${message}".`;
      }
      plan.steps.push({ args: ['commit', '-m', message], why: 'Record the snapshot in history.' });
      if (!current) warn('You are in detached HEAD mode. This commit will not belong to any branch; create a branch afterwards to keep it.');
      plan.preview.newCommits.push({ id: 'preview-0', parents: head ? [head] : [], subject: message || '(no message)' });
      if (current) plan.preview.moveRefs.push({ kind: 'branch', name: current, to: 'preview-0' });
      plan.preview.head = { branch: current, at: 'preview-0' };
      break;
    }

    case 'undo_last_commit': {
      const keep = op.keepChanges ?? 'staged';
      plan.title = 'Undo the last commit (keep the changes)';
      plan.learn = ['reset', 'revert'];
      plan.risk = 'careful';
      const lastCommit = snapshot.commits.find((c) => c.hash === head);
      if (!head || !lastCommit) block('There is no commit to undo.');
      else if (lastCommit.parents.length === 0) block("This is the repository's first commit, so there is nothing before it to go back to.");
      else if (lastCommit.parents.length > 1) block('The last commit is a merge. Use "revert" or "reset" with a specific target instead.');
      const parent = lastCommit?.parents[0];
      plan.summary = `Takes back the commit ${head ? shortName(snapshot, head) : ''} but keeps everything it changed as ${keep === 'staged' ? 'staged' : 'unstaged'} edits, so you can fix and commit again. Nothing is deleted.`;
      plan.steps.push({ args: ['reset', keep === 'staged' ? '--soft' : '--mixed', 'HEAD~1'], why: 'Move the branch back one commit without touching your files.' });
      if (status.upstream && status.ahead === 0 && head) {
        warn('This commit has already been pushed. Undoing it locally means you would need to force push later. "Revert" is the safer choice for shared commits.');
      }
      if (parent) {
        if (current) plan.preview.moveRefs.push({ kind: 'branch', name: current, to: parent });
        plan.preview.head = { branch: current, at: parent };
      }
      break;
    }

    case 'merge': {
      plan.title = `Merge "${op.branch}" into ${current ?? 'HEAD'}`;
      plan.learn = ['merge', 'fast-forward', 'conflict'];
      const theirs = await resolveCommit(repo, op.branch);
      if (!theirs) block(`Can't find "${op.branch}".`);
      if (!head) block('There are no commits yet to merge into.');
      if (!current) warn('You are in detached HEAD mode; the merge result will not be on a branch.');
      if (trackedDirty) {
        plan.risk = 'careful';
        warn('You have uncommitted edits. Commit or stash them first so a conflict can\'t tangle them up with the merge.');
      }
      if (theirs && head) {
        if (await isAncestor(repo, theirs, head)) {
          block(`Nothing to do: ${current ?? 'HEAD'} already contains everything in "${op.branch}".`);
        } else if (!op.noFastForward && (await isAncestor(repo, head, theirs))) {
          plan.summary = `Your branch hasn't changed since "${op.branch}" split off, so git just slides ${current ?? 'HEAD'} forward to ${shortName(snapshot, theirs)} (a fast-forward). No new commit is made.`;
          plan.steps.push({ args: ['merge', '--ff-only', op.branch], why: 'Move the branch forward to include the other branch\'s commits.' });
          if (current) plan.preview.moveRefs.push({ kind: 'branch', name: current, to: theirs });
          plan.preview.head = { branch: current, at: theirs };
        } else {
          const subject = `Merge branch '${op.branch}'${current && current !== 'main' && current !== 'master' ? ` into ${current}` : ''}`;
          plan.summary = `Combines the work from "${op.branch}" into ${current ?? 'HEAD'} with a new merge commit that has both as parents. Both histories are kept.`;
          plan.steps.push({ args: ['merge', '--no-edit', ...(op.noFastForward ? ['--no-ff'] : []), op.branch], why: 'Join the two lines of work.' });
          plan.preview.newCommits.push({ id: 'preview-0', parents: [head, theirs], subject });
          if (current) plan.preview.moveRefs.push({ kind: 'branch', name: current, to: 'preview-0' });
          plan.preview.head = { branch: current, at: 'preview-0' };
          const conflicts = await conflictedFiles(repo, head, theirs);
          if (conflicts && conflicts.length > 0) {
            plan.risk = 'careful';
            warn(`This merge will probably stop with conflicts in: ${conflicts.join(', ')}. You'll need to choose what those files should contain, or abort.`);
          }
        }
      }
      break;
    }

    case 'revert': {
      plan.title = 'Revert a commit';
      plan.learn = ['revert', 'reset'];
      const target = await resolveCommit(repo, op.commit);
      if (!target) block(`Can't find commit "${op.commit}".`);
      if (trackedDirty) block('Commit or stash your uncommitted edits first; revert needs a clean working tree.');
      const commit = snapshot.commits.find((c) => c.hash === target);
      if (commit && commit.parents.length > 1) block('Reverting a merge commit needs extra choices that Gitpicky doesn\'t handle yet.');
      const subject = commit ? `Revert "${commit.subject}"` : 'Revert';
      plan.summary = `Adds a new commit that does the exact opposite of ${target ? shortName(snapshot, target) : op.commit}. History is kept; this is the safe way to undo shared work.`;
      plan.steps.push({ args: ['revert', '--no-edit', op.commit], why: 'Create the undo commit.' });
      if (head) {
        plan.preview.newCommits.push({ id: 'preview-0', parents: [head], subject });
        if (current) plan.preview.moveRefs.push({ kind: 'branch', name: current, to: 'preview-0' });
        plan.preview.head = { branch: current, at: 'preview-0' };
      }
      break;
    }

    case 'cherry_pick': {
      plan.title = 'Cherry-pick a commit';
      plan.learn = ['cherry-pick'];
      const target = await resolveCommit(repo, op.commit);
      if (!target) block(`Can't find commit "${op.commit}".`);
      if (trackedDirty) block('Commit or stash your uncommitted edits first.');
      const commit = snapshot.commits.find((c) => c.hash === target);
      if (commit && commit.parents.length > 1) block('Cherry-picking a merge commit isn\'t supported.');
      if (target && head && (await isAncestor(repo, target, head))) block('That commit is already part of your current branch.');
      plan.summary = `Copies the changes from ${target ? shortName(snapshot, target) : op.commit} onto ${current ?? 'HEAD'} as a new commit. The original stays where it is.`;
      plan.steps.push({ args: ['cherry-pick', op.commit], why: 'Re-apply that commit\'s changes here.' });
      if (head) {
        plan.preview.newCommits.push({ id: 'preview-0', parents: [head], subject: commit?.subject ?? 'Cherry-picked commit' });
        if (current) plan.preview.moveRefs.push({ kind: 'branch', name: current, to: 'preview-0' });
        plan.preview.head = { branch: current, at: 'preview-0' };
      }
      break;
    }

    case 'reset': {
      plan.title = `Reset ${current ?? 'HEAD'} to ${op.to} (${op.mode})`;
      plan.learn = ['reset', 'reflog', 'revert'];
      const target = await resolveCommit(repo, op.to);
      if (!target) block(`Can't find "${op.to}".`);
      plan.risk = op.mode === 'hard' ? 'destructive' : 'careful';
      const where = target ? shortName(snapshot, target) : op.to;
      const lost = target && head && head !== target && !(await isAncestor(repo, head, target));
      plan.summary =
        `Moves ${current ?? 'HEAD'} back to ${where}. ` +
        (op.mode === 'soft'
          ? 'Changes from the commits you step over stay staged, ready to commit again.'
          : op.mode === 'mixed'
            ? 'Changes from the commits you step over stay in your files as unstaged edits.'
            : 'Your files are overwritten to match that commit. Uncommitted edits are thrown away.');
      plan.steps.push({ args: ['reset', `--${op.mode}`, op.to], why: 'Move the branch label (and, for hard, your files).' });
      if (op.mode === 'hard' && trackedDirty) warn('Your uncommitted edits will be permanently deleted. Stash them first if you might want them.');
      if (lost) warn('Commits after this point will no longer be on the branch. They can be recovered for a while through the reflog, but not easily.');
      if (status.upstream && lost && status.behind === 0) warn('If those commits were already pushed, you would need to force push, which affects anyone else using the branch.');
      if (target) {
        if (current) plan.preview.moveRefs.push({ kind: 'branch', name: current, to: target });
        plan.preview.head = { branch: current, at: target };
      }
      break;
    }

    case 'discard_changes': {
      plan.title = 'Discard uncommitted changes';
      plan.learn = ['working-tree', 'stash'];
      plan.risk = 'destructive';
      const files = op.files ?? [];
      if (!dirty) block('There are no changes to discard.');
      const untracked = status.changes.filter((c) => c.kind === 'untracked' && (files.length === 0 || files.includes(c.path)));
      const tracked = files.length
        ? files.filter((f) => status.changes.some((c) => c.path === f && c.kind !== 'untracked'))
        : status.changes.filter((c) => c.kind !== 'untracked').map((c) => c.path);
      if (tracked.length) {
        plan.steps.push({
          args: ['restore', '--staged', '--worktree', '--source=HEAD', '--', ...(files.length ? tracked : ['.'])],
          why: 'Put tracked files back to how they were in the last commit.',
        });
      }
      if (untracked.length) {
        plan.steps.push({ args: ['clean', '-f', '--', ...untracked.map((c) => c.path)], why: 'Delete new files git was not tracking yet.' });
      }
      plan.summary = `Throws away uncommitted edits${files.length ? ` in ${files.join(', ')}` : ' in every file'}, returning ${files.length ? 'them' : 'your folder'} to the last commit.${untracked.length ? ` ${untracked.length} new file${untracked.length === 1 ? '' : 's'} will be deleted.` : ''}`;
      warn('This cannot be undone. Stash instead if you might want these changes later.');
      break;
    }

    case 'stash': {
      plan.title = 'Stash changes';
      plan.learn = ['stash'];
      if (!dirty) block('There are no changes to stash.');
      const includeUntracked = op.includeUntracked ?? true;
      plan.summary = `Sets your ${changedCount(snapshot)} uncommitted change${changedCount(snapshot) === 1 ? '' : 's'} aside and cleans your folder back to the last commit. Bring them back any time with "stash pop".`;
      plan.steps.push({
        args: ['stash', 'push', ...(includeUntracked ? ['--include-untracked'] : []), ...(op.message ? ['-m', op.message] : [])],
        why: 'Save the edits in the stash and tidy the working tree.',
      });
      break;
    }

    case 'stash_pop': {
      plan.title = 'Bring back stashed changes';
      plan.learn = ['stash', 'conflict'];
      let count = 0;
      try {
        count = (await runGit(repo, ['stash', 'list'])).split('\n').filter(Boolean).length;
      } catch {
        count = 0;
      }
      if (count === 0) block('The stash is empty.');
      if (trackedDirty) {
        plan.risk = 'careful';
        warn('You already have uncommitted edits; if they touch the same lines, git will report conflicts.');
      }
      plan.summary = 'Re-applies the most recently stashed edits to your files and removes them from the stash.';
      plan.steps.push({ args: ['stash', 'pop'], why: 'Restore the edits.' });
      break;
    }

    case 'create_tag': {
      plan.title = `Tag "${op.name}"`;
      plan.learn = ['tag'];
      if (!(await isValidRefName(repo, op.name, 'tag'))) block(`"${op.name}" isn't a valid tag name.`);
      if (snapshot.tags.includes(op.name)) block(`A tag called "${op.name}" already exists.`);
      const target = await resolveCommit(repo, op.commit ?? 'HEAD');
      if (!target) block(`Can't find "${op.commit ?? 'HEAD'}".`);
      plan.summary = `Pins a permanent label "${op.name}" on ${target ? shortName(snapshot, target) : op.commit}. Tags never move, which makes them good for versions.`;
      plan.steps.push({
        args: ['tag', ...(op.message ? ['-a', '-m', op.message] : []), op.name, ...(op.commit ? [op.commit] : [])],
        why: 'Create the tag.',
      });
      if (target) plan.preview.moveRefs.push({ kind: 'tag', name: op.name, to: target });
      warn('Tags are not sent to the remote by a normal push; use "git push --tags" when you want to share them.');
      break;
    }

    case 'delete_branch': {
      plan.title = `Delete branch "${op.name}"`;
      plan.learn = ['branch', 'reflog'];
      if (!snapshot.branches.includes(op.name)) block(`There's no local branch called "${op.name}".`);
      if (current === op.name) block("You can't delete the branch you're on. Switch to another branch first.");
      const tip = await resolveCommit(repo, op.name);
      const merged = tip && head ? await isAncestor(repo, tip, head) : false;
      plan.risk = merged ? 'safe' : 'destructive';
      plan.summary = merged
        ? `Removes the "${op.name}" label. Its commits are already part of ${current ?? 'HEAD'}, so nothing is lost.`
        : `Removes the "${op.name}" label. Its commits are NOT merged anywhere you are, so they will be hard to find afterwards.`;
      if (!merged && !op.force) block(`"${op.name}" has commits that aren't merged. Merge it first, or ask again with force if you really want to throw them away.`);
      plan.steps.push({ args: ['branch', merged ? '-d' : '-D', op.name], why: 'Delete the branch label.' });
      plan.preview.removeRefs.push({ kind: 'branch', name: op.name });
      break;
    }

    case 'rename_branch': {
      const from = op.name ?? current;
      plan.title = `Rename branch "${from}" to "${op.newName}"`;
      plan.learn = ['branch', 'upstream'];
      if (!from) block('You are not on a branch; say which branch to rename.');
      else if (!snapshot.branches.includes(from)) block(`There's no local branch called "${from}".`);
      if (snapshot.branches.includes(op.newName)) block(`A branch called "${op.newName}" already exists.`);
      if (!(await isValidRefName(repo, op.newName, 'branch'))) block(`"${op.newName}" isn't a valid branch name.`);
      plan.summary = `Renames the label "${from}" to "${op.newName}". Commits don't change.`;
      plan.steps.push({ args: ['branch', '-m', ...(op.name ? [op.name] : []), op.newName], why: 'Rename the branch.' });
      if (from) {
        const tip = await resolveCommit(repo, from);
        plan.preview.removeRefs.push({ kind: 'branch', name: from });
        if (tip) plan.preview.moveRefs.push({ kind: 'branch', name: op.newName, to: tip });
        if (from === current && tip) plan.preview.head = { branch: op.newName, at: tip };
      }
      if (status.upstream) warn('The branch on the remote keeps its old name until you push the new one.');
      break;
    }

    case 'fetch': {
      const remote = op.remote ?? snapshot.remotes[0];
      plan.title = `Fetch from ${remote ?? 'remote'}`;
      plan.learn = ['fetch', 'remote'];
      if (!remote) block('This repository has no remote to fetch from.');
      plan.summary = `Downloads new commits from ${remote} and updates the ${remote}/… labels. Your own branches and files are not touched.`;
      plan.steps.push({ args: ['fetch', '--prune', ...(remote ? [remote] : [])], why: 'Download and refresh remote labels.' });
      break;
    }

    case 'pull': {
      plan.title = 'Pull';
      plan.learn = ['pull', 'fetch', 'merge', 'ahead-behind'];
      if (!current) block('You are not on a branch, so there is nothing to pull into.');
      if (!status.upstream) block(`"${current}" isn't linked to a remote branch yet, so git doesn't know where to pull from.`);
      if (trackedDirty) {
        plan.risk = 'careful';
        warn('You have uncommitted edits. Commit or stash first so incoming changes can\'t clash with them.');
      }
      if (status.ahead > 0) warn(`You also have ${status.ahead} local commit${status.ahead === 1 ? '' : 's'}, so this will create a merge commit (or conflicts) rather than a simple fast-forward.`);
      plan.summary = `Downloads new commits from ${status.upstream ?? 'the remote'} and merges them into ${current}.`;
      plan.steps.push({ args: ['pull', '--no-rebase', '--no-edit'], why: 'Fetch, then merge the remote branch into yours.' });
      break;
    }

    case 'push': {
      plan.title = 'Push';
      plan.learn = ['push', 'remote', 'upstream'];
      if (!current) block('You are not on a branch, so there is nothing to push.');
      if (!head) block('There are no commits to push.');
      const remote = snapshot.remotes[0];
      if (!status.upstream && !remote) block('This repository has no remote to push to. Add one (for example on GitHub) first.');
      if (status.behind > 0) block(`The remote has ${status.behind} commit${status.behind === 1 ? '' : 's'} you don't have. Pull first, then push.`);
      if (status.upstream && status.ahead === 0) block('Nothing to push: the remote already has all your commits.');
      if (status.upstream) {
        plan.summary = `Uploads ${status.ahead} commit${status.ahead === 1 ? '' : 's'} from ${current} to ${status.upstream}.`;
        plan.steps.push({ args: ['push'], why: 'Send your commits to the remote.' });
        if (head) plan.preview.moveRefs.push({ kind: 'remote', name: status.upstream, to: head });
      } else if (remote && current) {
        plan.summary = `Publishes ${current} to ${remote} for the first time and links them, so later pushes and pulls know where to go.`;
        plan.steps.push({ args: ['push', '--set-upstream', remote, current], why: 'Create the branch on the remote and link to it.' });
        if (head) plan.preview.moveRefs.push({ kind: 'remote', name: `${remote}/${current}`, to: head });
      }
      break;
    }

    case 'abort': {
      plan.title = `Abort the ${status.inProgress ?? 'operation'}`;
      plan.learn = ['conflict'];
      if (!status.inProgress) block('Nothing is in progress.');
      else {
        plan.risk = 'careful';
        plan.summary = `Cancels the ${status.inProgress} and puts everything back to how it was before it started. Any conflict fixes you made are thrown away.`;
        plan.steps.push({ args: [status.inProgress, '--abort'], why: `Stop the ${status.inProgress}.` });
      }
      break;
    }

    default: {
      const never: never = op;
      block(`Unknown operation: ${JSON.stringify(never)}`);
    }
  }

  return plan;
}

export interface ExecutionResult {
  ok: boolean;
  /** Output of each step that ran. */
  log: { command: string; output: string }[];
  error?: string;
  /** HEAD before the change, so it can be found in the reflog if needed. */
  headBefore: string | null;
}

/** Re-checks a plan against the current repo state and runs it. Stops at the first failing step. */
export async function executePlan(repo: string, op: Operation): Promise<ExecutionResult & { plan: Plan }> {
  const plan = await planChange(repo, op);
  const headBefore = await resolveCommit(repo, 'HEAD');
  if (plan.blockers.length > 0) {
    return { ok: false, plan, log: [], error: plan.blockers.join(' '), headBefore };
  }
  const log: ExecutionResult['log'] = [];
  for (const step of plan.steps) {
    const command = formatCommand(step.args);
    try {
      const output = await runGit(repo, step.args, { timeoutMs: 5 * 60_000 });
      log.push({ command, output: output.trim() });
    } catch (error) {
      const message = error instanceof GitError ? error.stderr.trim() || error.message : String(error);
      log.push({ command, output: message });
      return { ok: false, plan, log, error: message, headBefore };
    }
  }
  return { ok: true, plan, log, headBefore };
}
