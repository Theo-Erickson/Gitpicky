// Plain-English explanations of git words. Shared by the app's Learn panel and
// the MCP server's explain_git_term tool. No imports, so the renderer can use it.

export interface GlossaryEntry {
  id: string;
  term: string;
  aliases: string[];
  /** One sentence, shown in tooltips. */
  short: string;
  /** A few sentences for the Learn panel. */
  explanation: string;
  /** An everyday comparison. */
  analogy?: string;
  /** What it looks like in Gitpicky's picture. */
  inPicture?: string;
  /** The command people usually type for it. */
  command?: string;
  /** A heads-up when it can lose work or surprise people. */
  caution?: string;
  related: string[];
}

export const GLOSSARY: GlossaryEntry[] = [
  {
    id: 'repository',
    term: 'Repository (repo)',
    aliases: ['repo', 'repository', '.git'],
    short: 'A project folder whose full history git is keeping track of.',
    explanation:
      'A repository is your project folder plus a hidden .git folder where git stores every saved version. Deleting the .git folder deletes the history but leaves your current files alone.',
    analogy: 'A notebook where every page you ever wrote is kept, even after you rewrite it.',
    inPicture: 'The whole picture is one repository.',
    command: 'git init',
    related: ['commit', 'clone', 'remote'],
  },
  {
    id: 'commit',
    term: 'Commit',
    aliases: ['commits', 'committing', 'snapshot', 'save point'],
    short: 'A saved snapshot of your project, with a message describing what changed.',
    explanation:
      'A commit records exactly what every tracked file looked like at one moment, who made it, when, and why (the message). Each commit points back to the commit(s) before it, which is what forms the history. Commits are identified by a long hash like 3f2a9c1.',
    analogy: 'A save point in a video game you can always go back to.',
    inPicture: 'Each dot is a commit. Lines connect it to the commit(s) it came from.',
    command: 'git commit -m "message"',
    related: ['hash', 'parent', 'staging-area', 'amend'],
  },
  {
    id: 'hash',
    term: 'Hash (commit ID)',
    aliases: ['sha', 'sha1', 'commit id', 'id', 'oid'],
    short: 'The unique fingerprint of a commit, like 3f2a9c1.',
    explanation:
      "Git names every commit with a 40-character code computed from its contents. You usually only need the first 7 characters. If anything about a commit changed, its hash would change too, which is why 'rewriting history' creates new commits instead of editing old ones.",
    inPicture: 'Shown in grey next to each commit.',
    related: ['commit'],
  },
  {
    id: 'parent',
    term: 'Parent commit',
    aliases: ['parents', 'ancestor', 'child'],
    short: 'The commit that came right before another one.',
    explanation:
      'Every commit except the very first remembers its parent. A merge commit has two parents: one from each branch it joined. Following parents backward walks you through the history.',
    inPicture: 'The line going down from a dot leads to its parent.',
    related: ['commit', 'merge'],
  },
  {
    id: 'branch',
    term: 'Branch',
    aliases: ['branches', 'branching'],
    short: 'A movable name tag pointing at the latest commit of one line of work.',
    explanation:
      "A branch is just a label that points at a commit. When you commit while on a branch, the label moves forward to the new commit. Making a branch is cheap and safe: it doesn't copy files, it only adds a label so you can work on something without disturbing main.",
    analogy: 'A bookmark that moves to the newest page each time you write.',
    inPicture: 'Colored tags next to commits. A new branch line gets its own color.',
    command: 'git switch -c new-branch',
    related: ['head', 'main', 'checkout', 'merge'],
  },
  {
    id: 'main',
    term: 'main / master',
    aliases: ['master', 'default branch', 'trunk'],
    short: "The project's primary branch, by convention.",
    explanation:
      "Most repositories treat one branch as the official version, usually called main (older projects use master). There's nothing special about it to git; it's a team agreement.",
    related: ['branch'],
  },
  {
    id: 'head',
    term: 'HEAD',
    aliases: ['current commit', 'you are here'],
    short: '"You are here": the commit your files currently match.',
    explanation:
      "HEAD is git's pointer to where you are. Normally it points at a branch (HEAD -> main), which means new commits go onto that branch. Your working files match the commit HEAD points to, plus any edits you haven't committed.",
    analogy: 'The "you are here" marker on a mall map.',
    inPicture: 'The commit with the HEAD badge and the ring around its dot.',
    related: ['detached-head', 'branch', 'checkout'],
  },
  {
    id: 'detached-head',
    term: 'Detached HEAD',
    aliases: ['detached', 'headless'],
    short: "You're looking at a commit directly, not on any branch.",
    explanation:
      "This happens when you check out a specific commit or tag instead of a branch. It's safe for looking around. But if you make commits here, no branch label follows them, so they're easy to lose once you switch away. To keep work made here, create a branch before switching.",
    analogy: 'Wandering off the marked trail: fine for exploring, but drop a pin if you want to find your way back.',
    inPicture: 'HEAD badge sits on a commit with no branch tag marked as current.',
    command: 'git switch -c keep-my-work',
    caution: 'Commits made while detached can be lost when you switch away unless you create a branch.',
    related: ['head', 'branch', 'checkout'],
  },
  {
    id: 'working-tree',
    term: 'Working tree',
    aliases: ['working directory', 'working copy', 'unstaged', 'local changes', 'uncommitted changes'],
    short: 'The actual files on your disk that you edit.',
    explanation:
      "Your working tree is the normal folder you open in your editor. Changes there aren't part of history until you stage and commit them.",
    inPicture: 'Uncommitted edits show as a dashed "Your changes" dot above HEAD.',
    related: ['staging-area', 'commit', 'stash'],
  },
  {
    id: 'staging-area',
    term: 'Staging area (index)',
    aliases: ['stage', 'staged', 'index', 'add', 'git add', 'cache'],
    short: 'The list of changes you have picked to go into the next commit.',
    explanation:
      "Git lets you choose exactly which changes become the next commit. 'Staging' a file (git add) puts it on that list. Files you changed but didn't stage stay out of the commit and remain as local edits.",
    analogy: 'Packing a box before you tape it shut: only what you put in the box ships.',
    command: 'git add <file>',
    related: ['working-tree', 'commit'],
  },
  {
    id: 'untracked',
    term: 'Untracked file',
    aliases: ['untracked files', 'new file'],
    short: "A file git has never been told to keep track of.",
    explanation:
      "New files start out untracked. Git ignores them in commits until you add them. Files listed in .gitignore stay untracked on purpose (build outputs, secrets, caches).",
    related: ['staging-area', 'gitignore'],
  },
  {
    id: 'gitignore',
    term: '.gitignore',
    aliases: ['ignore', 'ignored'],
    short: 'A list of files and folders git should never track.',
    explanation:
      'Put patterns in a .gitignore file to keep things like build output, downloaded packages or passwords out of the repository.',
    related: ['untracked'],
  },
  {
    id: 'checkout',
    term: 'Checkout / Switch',
    aliases: ['switch', 'check out', 'git checkout', 'git switch'],
    short: 'Move HEAD to another branch or commit, updating your files to match.',
    explanation:
      "Switching to a branch changes the files in your folder to that branch's latest commit. Git refuses if your uncommitted edits would be overwritten; commit or stash them first. 'git switch' is the newer, clearer command for branches; 'git checkout' does that and more.",
    command: 'git switch <branch>',
    related: ['head', 'branch', 'stash'],
  },
  {
    id: 'merge',
    term: 'Merge',
    aliases: ['merging', 'merge commit'],
    short: "Bring another branch's commits into your current branch.",
    explanation:
      "Merging combines two lines of work. If your branch hasn't moved since the other branch split off, git simply slides your label forward (a fast-forward). Otherwise git makes a merge commit with two parents. If both sides changed the same lines, you get a conflict to resolve.",
    analogy: 'Two streams joining into one river.',
    inPicture: 'A merge commit is drawn as a ringed dot where two lines meet.',
    command: 'git merge <branch>',
    related: ['fast-forward', 'conflict', 'rebase'],
  },
  {
    id: 'fast-forward',
    term: 'Fast-forward',
    aliases: ['ff', 'fast forward'],
    short: 'Catching a branch up by just moving its label forward, no new commit.',
    explanation:
      "When the branch you're merging already contains all your commits, there's nothing to combine: git moves your branch label to the newer commit. No merge commit is made.",
    related: ['merge'],
  },
  {
    id: 'conflict',
    term: 'Merge conflict',
    aliases: ['conflicts', 'conflicted', 'conflict markers'],
    short: 'Both sides changed the same lines, so git needs you to choose.',
    explanation:
      "Git marks the file with <<<<<<<, ======= and >>>>>>> showing both versions. Edit the file to what it should be, remove the markers, stage it, and finish the merge with a commit. You can also abort to go back to how things were before the merge started.",
    command: 'git merge --abort',
    caution: "Don't panic: aborting puts everything back the way it was before the merge.",
    related: ['merge', 'rebase'],
  },
  {
    id: 'rebase',
    term: 'Rebase',
    aliases: ['rebasing', 'git rebase'],
    short: 'Replay your commits on top of another branch, making new copies.',
    explanation:
      "Rebasing takes the commits unique to your branch and re-applies them one by one on top of another branch, so history looks like a straight line. The replayed commits are new commits with new hashes; the originals are left behind.",
    analogy: 'Re-doing your homework on a fresh worksheet so it looks like you started from the latest version.',
    caution: "Avoid rebasing commits you've already pushed and shared; others will have the old copies.",
    command: 'git rebase main',
    related: ['merge', 'force-push'],
  },
  {
    id: 'cherry-pick',
    term: 'Cherry-pick',
    aliases: ['cherry pick', 'cherrypick'],
    short: 'Copy one specific commit onto your current branch.',
    explanation:
      "Cherry-picking takes the changes from a single commit elsewhere and applies them as a new commit where you are. Useful for grabbing one fix without merging a whole branch.",
    command: 'git cherry-pick <commit>',
    related: ['commit', 'merge'],
  },
  {
    id: 'revert',
    term: 'Revert',
    aliases: ['reverting', 'git revert', 'undo commit safely'],
    short: 'Make a new commit that undoes an earlier commit.',
    explanation:
      "Revert doesn't erase anything. It adds a new commit that does the opposite of the one you pick. That keeps history honest and is the safe way to undo something that's already been shared.",
    analogy: 'Writing a correction in the next issue of the newspaper instead of recalling the old one.',
    command: 'git revert <commit>',
    related: ['reset', 'commit'],
  },
  {
    id: 'reset',
    term: 'Reset',
    aliases: ['git reset', 'reset --hard', 'reset --soft', 'reset --mixed', 'hard reset', 'soft reset'],
    short: 'Move your branch label back to an earlier commit.',
    explanation:
      "Reset moves the current branch to another commit. --soft keeps the undone changes staged; --mixed (the default) keeps them as unstaged edits; --hard throws away the changes and any uncommitted edits. The commits you moved away from still exist for a while (see reflog) but no branch points at them.",
    caution: '--hard permanently discards uncommitted edits. Gitpicky always asks before doing it.',
    command: 'git reset --soft HEAD~1',
    related: ['revert', 'reflog'],
  },
  {
    id: 'amend',
    term: 'Amend',
    aliases: ['commit --amend', 'amending'],
    short: 'Replace the last commit with a fixed-up version.',
    explanation:
      "Amending lets you change the last commit's message or add a forgotten file. It actually creates a new commit to replace the old one, so avoid amending commits you've already pushed.",
    command: 'git commit --amend',
    related: ['commit', 'force-push'],
  },
  {
    id: 'stash',
    term: 'Stash',
    aliases: ['stashing', 'git stash', 'stash pop', 'shelve'],
    short: 'Put your uncommitted edits aside temporarily.',
    explanation:
      "Stashing saves your uncommitted changes to a side pocket and cleans your working tree, so you can switch branches or pull. 'Stash pop' brings them back.",
    analogy: 'Sweeping your desk into a drawer so you can work on something else, then pulling it back out.',
    command: 'git stash / git stash pop',
    related: ['working-tree', 'checkout'],
  },
  {
    id: 'tag',
    term: 'Tag',
    aliases: ['tags', 'release', 'version tag'],
    short: "A permanent name for one commit, often a version like v1.0.",
    explanation:
      "Unlike a branch, a tag never moves. Tags mark important points such as releases.",
    inPicture: 'Tag badges have a little notch on the left.',
    command: 'git tag v1.0',
    related: ['branch'],
  },
  {
    id: 'remote',
    term: 'Remote',
    aliases: ['remotes', 'origin', 'upstream repo', 'github'],
    short: 'Another copy of the repository, usually on GitHub, that you sync with.',
    explanation:
      "A remote is a named link to a repository somewhere else. 'origin' is the default name for the one you cloned from. Remote branches like origin/main show where that branch was on the remote the last time you fetched.",
    inPicture: 'Remote branch badges are outlined and start with the remote name, like origin/main.',
    related: ['fetch', 'pull', 'push', 'upstream'],
  },
  {
    id: 'upstream',
    term: 'Upstream (tracking branch)',
    aliases: ['tracking', 'tracking branch', 'set-upstream'],
    short: 'The remote branch your local branch syncs with by default.',
    explanation:
      "When a branch has an upstream, git knows where 'push' and 'pull' should go and can tell you how far ahead or behind you are.",
    related: ['remote', 'ahead-behind'],
  },
  {
    id: 'ahead-behind',
    term: 'Ahead / Behind',
    aliases: ['ahead', 'behind', 'diverged'],
    short: 'How many commits you have that the remote lacks, and vice versa.',
    explanation:
      "'Ahead 2' means you have 2 commits to push. 'Behind 3' means the remote has 3 you haven't pulled. Both at once means the branches have diverged and will need a merge or rebase when you pull.",
    related: ['push', 'pull', 'upstream'],
  },
  {
    id: 'fetch',
    term: 'Fetch',
    aliases: ['fetching', 'git fetch'],
    short: "Download new commits from the remote without changing your files.",
    explanation:
      "Fetch updates your view of the remote (origin/main and friends) but leaves your own branches and files alone. It's always safe.",
    command: 'git fetch',
    related: ['pull', 'remote'],
  },
  {
    id: 'pull',
    term: 'Pull',
    aliases: ['pulling', 'git pull'],
    short: 'Fetch from the remote, then merge those changes into your branch.',
    explanation:
      'Pull is fetch followed by merge (or rebase, depending on settings). It brings your branch up to date with the remote.',
    command: 'git pull',
    related: ['fetch', 'merge', 'conflict'],
  },
  {
    id: 'push',
    term: 'Push',
    aliases: ['pushing', 'git push'],
    short: 'Upload your commits to the remote.',
    explanation:
      "Pushing sends your new commits to the remote and moves the remote branch to match. Git rejects the push if the remote has commits you don't have; pull first.",
    command: 'git push',
    related: ['pull', 'force-push', 'remote'],
  },
  {
    id: 'force-push',
    term: 'Force push',
    aliases: ['push --force', 'force', 'force-with-lease'],
    short: "Overwrite the remote branch with yours, even if it loses the remote's commits.",
    explanation:
      "Needed after rewriting history (rebase, amend) that was already pushed. It replaces what's on the remote. --force-with-lease is the safer form: it refuses if someone else pushed in the meantime.",
    caution: 'Can delete teammates\' work on the remote. Gitpicky never does this without an explicit approval.',
    related: ['push', 'rebase', 'amend'],
  },
  {
    id: 'clone',
    term: 'Clone',
    aliases: ['cloning', 'git clone'],
    short: 'Download a full copy of a repository, history and all.',
    explanation: 'Cloning creates a new folder with every commit and sets up origin to point where you cloned from.',
    command: 'git clone <url>',
    related: ['remote', 'fork'],
  },
  {
    id: 'fork',
    term: 'Fork',
    aliases: ['forking'],
    short: "Your own copy of someone else's repository on GitHub.",
    explanation:
      "Forking is a GitHub feature, not a git command. It copies a repository into your account so you can change it freely and propose changes back with a pull request.",
    related: ['clone', 'pull-request'],
  },
  {
    id: 'pull-request',
    term: 'Pull request (PR)',
    aliases: ['pr', 'merge request', 'mr'],
    short: 'A request on GitHub to merge one branch into another, with review.',
    explanation:
      "Pull requests are a GitHub/GitLab feature for discussing and reviewing a branch before it's merged.",
    related: ['merge', 'fork', 'branch'],
  },
  {
    id: 'reflog',
    term: 'Reflog',
    aliases: ['git reflog', 'lost commit', 'recover'],
    short: "Git's private diary of everywhere HEAD has been: your safety net.",
    explanation:
      "Even after a reset or a deleted branch, the commits usually still exist for weeks. The reflog lists where HEAD pointed recently, so you can find and restore them.",
    command: 'git reflog',
    related: ['reset', 'detached-head'],
  },
  {
    id: 'squash',
    term: 'Squash',
    aliases: ['squashing', 'squash merge'],
    short: 'Combine several commits into one.',
    explanation:
      'Squashing tidies history by folding many small commits into a single one, often when merging a pull request.',
    related: ['rebase', 'merge'],
  },
];

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim();
}

/** Finds the glossary entry best matching a word or phrase, or null. */
export function lookupTerm(query: string): GlossaryEntry | null {
  const q = normalize(query);
  if (!q) return null;
  const exact = GLOSSARY.find(
    (e) => e.id === q.replace(/ /g, '-') || normalize(e.term) === q || e.aliases.some((a) => normalize(a) === q),
  );
  if (exact) return exact;
  return (
    GLOSSARY.find((e) => normalize(e.term).includes(q) || e.aliases.some((a) => normalize(a).includes(q))) ?? null
  );
}

/** Formats an entry as Markdown, for the MCP server. */
export function formatEntry(entry: GlossaryEntry): string {
  const lines = [`**${entry.term}**: ${entry.short}`, '', entry.explanation];
  if (entry.analogy) lines.push('', `Think of it like: ${entry.analogy}`);
  if (entry.inPicture) lines.push('', `In Gitpicky: ${entry.inPicture}`);
  if (entry.command) lines.push('', `Usual command: \`${entry.command}\``);
  if (entry.caution) lines.push('', `Careful: ${entry.caution}`);
  if (entry.related.length) {
    const names = entry.related.map((id) => GLOSSARY.find((e) => e.id === id)?.term ?? id);
    lines.push('', `Related: ${names.join(', ')}`);
  }
  return lines.join('\n');
}
