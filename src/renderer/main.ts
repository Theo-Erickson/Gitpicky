import type { RunOutcome } from '../app/api';
import { lookupTerm } from '../core/glossary';
import { applyPreview, type Operation, type Plan } from '../core/preview';
import type { Commit, FileChange, Ref, RepoSnapshot } from '../core/types';
import { ask, closeDialog, showPlanDialog } from './dialogs';
import { clear, h, relativeTime } from './dom';
import { WORKING_HASH, badge, renderGraph } from './graph-view';
import { renderLearn } from './learn';

type Tab = 'details' | 'learn';

interface State {
  snapshot: RepoSnapshot | null;
  error: string | null;
  selected: string | null;
  selectedRef: Ref | null;
  preview: Plan | null;
  tab: Tab;
  learn: { query: string; open: string | null };
  files: Map<string, FileChange[]>;
  /** Working-tree files ticked for the next commit. */
  picked: Set<string> | null;
  commitMessage: string;
  recent: string[];
}

const state: State = {
  snapshot: null,
  error: null,
  selected: null,
  selectedRef: null,
  preview: null,
  tab: 'details',
  learn: { query: '', open: null },
  files: new Map(),
  picked: null,
  commitMessage: '',
  recent: [],
};

const api = window.gitpicky;
const root = document.getElementById('app')!;

// ---------------------------------------------------------------- data

async function load(result: Promise<{ ok: true; value: RepoSnapshot } | { ok: false; error: string } | null>): Promise<void> {
  const r = await result;
  if (!r) return;
  if (r.ok) {
    const changedRepo = state.snapshot?.path !== r.value.path;
    state.snapshot = r.value;
    state.error = null;
    if (changedRepo) {
      state.selected = null;
      state.selectedRef = null;
      state.files.clear();
      state.picked = null;
    }
    // Forget ticks for files that no longer have changes.
    if (state.picked) {
      const paths = new Set(r.value.status.changes.map((c) => c.path));
      state.picked = new Set([...state.picked].filter((p) => paths.has(p)));
    }
    if (state.selected && state.selected !== WORKING_HASH && !r.value.commits.some((c) => c.hash === state.selected)) {
      state.selected = null;
    }
  } else {
    state.error = r.error;
  }
  render();
}

let refreshing = false;
async function refresh(): Promise<void> {
  if (refreshing || !state.snapshot) return;
  refreshing = true;
  try {
    await load(api.refresh());
  } finally {
    refreshing = false;
  }
}

// ---------------------------------------------------------------- actions

function openLearn(id: string): void {
  state.tab = 'learn';
  state.learn = { query: '', open: id };
  closeDialog();
  state.preview = null;
  render();
  document.getElementById(`learn-${id}`)?.scrollIntoView({ block: 'start' });
}

/** Plans an operation, previews it in the graph and asks for approval before running it. */
async function propose(op: Operation): Promise<void> {
  const planned = await api.plan(op);
  if (!planned.ok) {
    alertBox(planned.error);
    return;
  }
  state.preview = planned.value.blockers.length ? null : planned.value;
  render();
  showPlanDialog({
    plan: planned.value,
    onCancel: () => {
      closeDialog();
      state.preview = null;
      render();
    },
    onLearn: openLearn,
    onApprove: async () => {
      const ran = await api.run(op);
      const outcome: RunOutcome | null = ran.ok ? ran.value : null;
      if (outcome?.ok) {
        closeDialog();
        state.preview = null;
        if (op.type === 'commit') {
          state.commitMessage = '';
          state.picked = null;
        }
        await refresh();
        flash(`${planned.value.title}: done.`);
      } else {
        state.preview = null;
        await refresh();
      }
      return { ok: !!outcome?.ok, error: ran.ok ? ran.value.error : ran.error, log: outcome?.log };
    },
  });
}

function alertBox(message: string): void {
  void ask(message, [], 'OK');
}

let flashTimer: number | undefined;
function flash(message: string): void {
  const el = document.getElementById('flash');
  if (!el) return;
  el.textContent = message;
  el.classList.add('visible');
  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => el.classList.remove('visible'), 3200);
}

async function askBranchName(title: string, from?: string): Promise<void> {
  const values = await ask(title, [
    { name: 'name', label: 'Branch name', placeholder: 'e.g. fix-jump-height', hint: 'Short, no spaces. Dashes and slashes are fine (art/new-sprites).' },
    { name: 'switchTo', label: 'Switch to it right away', type: 'checkbox', value: 'true' },
  ]);
  if (!values?.name) return;
  await propose({ type: 'create_branch', name: values.name, from, switchTo: values.switchTo === 'true' });
}

// ---------------------------------------------------------------- rendering

function displayCommits(snapshot: RepoSnapshot): Commit[] {
  if (state.preview) return applyPreview(snapshot.commits, state.preview.preview);
  const { status } = snapshot;
  const changed = new Set(status.changes.map((c) => c.path)).size;
  if (changed === 0) return snapshot.commits;
  const working: Commit = {
    hash: WORKING_HASH,
    shortHash: '',
    parents: status.headHash ? [status.headHash] : [],
    authorName: '',
    authorEmail: '',
    date: '',
    subject: `Your uncommitted changes (${changed} file${changed === 1 ? '' : 's'})`,
    refs: [],
  };
  return [working, ...snapshot.commits];
}

function header(snapshot: RepoSnapshot | null): HTMLElement {
  const s = snapshot?.status;
  return h(
    'header',
    { class: 'topbar' },
    h('div', { class: 'brand' }, h('img', { src: '../../assets/icons/gitpicky-pick-64.png', alt: '' }), h('span', null, 'Gitpicky')),
    snapshot
      ? h(
          'div',
          { class: 'repo-info' },
          h('button', { class: 'repo-name', type: 'button', title: snapshot.path, onclick: () => load(api.pickRepo()) }, snapshot.name, h('span', { class: 'caret' }, '▾')),
          s?.branch
            ? h('span', { class: 'on-branch', title: lookupTerm('head')?.short }, 'on ', h('strong', null, s.branch))
            : h('button', { class: 'on-branch warn', type: 'button', onclick: () => openLearn('detached-head'), title: 'Click to learn what this means' }, 'detached HEAD'),
          s?.upstream
            ? h(
                'button',
                { class: 'sync', type: 'button', title: `Compared with ${s.upstream}. Click to learn more.`, onclick: () => openLearn('ahead-behind') },
                `↑${s.ahead} ↓${s.behind}`,
              )
            : null,
        )
      : h('div', { class: 'repo-info' }),
    snapshot
      ? h(
          'div',
          { class: 'top-actions' },
          snapshot.remotes.length ? h('button', { type: 'button', title: lookupTerm('fetch')?.short, onclick: () => propose({ type: 'fetch' }) }, 'Fetch') : null,
          s?.upstream ? h('button', { type: 'button', title: lookupTerm('pull')?.short, onclick: () => propose({ type: 'pull' }) }, 'Pull') : null,
          snapshot.remotes.length ? h('button', { type: 'button', title: lookupTerm('push')?.short, onclick: () => propose({ type: 'push' }) }, 'Push') : null,
          h('button', { type: 'button', onclick: () => askBranchName('New branch from where you are') }, 'New branch'),
        )
      : null,
  );
}

function welcome(): HTMLElement {
  return h(
    'div',
    { class: 'welcome' },
    h('img', { src: '../../assets/icons/gitpicky-pick-256.png', alt: '', class: 'welcome-logo' }),
    h('h1', null, 'Git, explained by picture.'),
    h('p', null, 'Open a project folder that uses git. Gitpicky will draw its history, explain what everything means, and show you what each change will do before it happens.'),
    state.error ? h('div', { class: 'callout callout-blocker' }, state.error) : null,
    h('button', { class: 'primary big', type: 'button', onclick: () => load(api.pickRepo()) }, 'Open a repository…'),
    state.recent.length
      ? h(
          'div',
          { class: 'recent' },
          h('h3', null, 'Recent'),
          state.recent.map((p) => h('button', { class: 'recent-item', type: 'button', onclick: () => load(api.openRepo(p)) }, p)),
        )
      : null,
  );
}

function inProgressBanner(snapshot: RepoSnapshot): HTMLElement | null {
  const op = snapshot.status.inProgress;
  if (!op) return null;
  const conflicts = snapshot.status.changes.filter((c) => c.kind === 'conflicted');
  return h(
    'div',
    { class: 'banner' },
    h('strong', null, `A ${op} is in progress. `),
    conflicts.length
      ? `${conflicts.length} file${conflicts.length === 1 ? ' has' : 's have'} conflicts: ${conflicts.map((c) => c.path).join(', ')}. Fix them in your editor, then commit. `
      : 'Commit to finish it. ',
    h('button', { class: 'chip', type: 'button', onclick: () => openLearn('conflict') }, 'What does this mean?'),
    h('button', { type: 'button', onclick: () => propose({ type: 'abort' }) }, `Abort ${op}`),
  );
}

function statusBar(snapshot: RepoSnapshot): HTMLElement {
  const s = snapshot.status;
  const staged = s.changes.filter((c) => c.staged).length;
  const changed = new Set(s.changes.map((c) => c.path)).size;
  const parts: (HTMLElement | string)[] = [];
  parts.push(s.branch ? `On branch ${s.branch}` : 'Detached HEAD');
  if (s.upstream) parts.push(s.ahead || s.behind ? `${s.ahead} ahead, ${s.behind} behind ${s.upstream}` : `in sync with ${s.upstream}`);
  else if (s.branch && snapshot.remotes.length) parts.push('not published yet');
  parts.push(changed ? `${changed} changed file${changed === 1 ? '' : 's'}${staged ? ` (${staged} staged)` : ''}` : 'no uncommitted changes');
  if (snapshot.truncated) parts.push(`showing the newest ${snapshot.commits.length} commits`);
  return h('footer', { class: 'statusbar' }, parts.join('  ·  '), h('span', { id: 'flash', class: 'flash' }));
}

function fileRow(file: FileChange, extra?: HTMLElement | null): HTMLElement {
  const kindLabel: Record<FileChange['kind'], string> = {
    modified: 'M',
    added: 'A',
    deleted: 'D',
    renamed: 'R',
    copied: 'C',
    untracked: 'new',
    conflicted: '!',
    'type-changed': 'T',
  };
  return h(
    'li',
    { class: `file file-${file.kind}` },
    extra ?? null,
    h('span', { class: 'file-kind', title: file.kind }, kindLabel[file.kind]),
    h('span', { class: 'file-path', title: file.from ? `${file.from} → ${file.path}` : file.path }, file.path),
  );
}

function workingPanel(snapshot: RepoSnapshot): HTMLElement {
  const changes = snapshot.status.changes;
  const paths = [...new Set(changes.map((c) => c.path))];
  if (!state.picked) state.picked = new Set(paths);
  const picked = state.picked;
  const message = h('textarea', {
    class: 'commit-message',
    placeholder: 'Describe what you changed, e.g. "Make the jump feel snappier"',
    rows: 3,
  });
  message.value = state.commitMessage;
  message.addEventListener('input', () => (state.commitMessage = message.value));

  const selectedFiles = () => paths.filter((p) => picked.has(p));

  return h(
    'section',
    { class: 'panel' },
    h('h2', null, 'Your changes'),
    h('p', { class: 'muted' }, 'These edits are in your folder but not saved into history yet. Tick the files you want in the next commit. ', h('button', { class: 'chip', type: 'button', onclick: () => openLearn('staging-area') }, 'How does this work?')),
    h(
      'ul',
      { class: 'files' },
      paths.map((path) => {
        const file = changes.find((c) => c.path === path && !c.staged) ?? changes.find((c) => c.path === path)!;
        const box = h('input', { type: 'checkbox', checked: picked.has(path) });
        box.addEventListener('change', () => {
          if (box.checked) picked.add(path);
          else picked.delete(path);
        });
        return fileRow(file, box);
      }),
    ),
    message,
    h(
      'div',
      { class: 'actions' },
      h(
        'button',
        {
          class: 'primary',
          type: 'button',
          onclick: () => {
            const files = selectedFiles();
            if (files.length === 0) return alertBox('Tick at least one file to commit.');
            void propose({ type: 'commit', message: state.commitMessage, files });
          },
        },
        'Commit…',
      ),
      h('button', { type: 'button', title: lookupTerm('stash')?.short, onclick: () => propose({ type: 'stash' }) }, 'Stash all'),
      h(
        'button',
        {
          class: 'danger-text',
          type: 'button',
          onclick: () => {
            const files = selectedFiles();
            if (files.length === 0) return alertBox('Tick the files whose changes you want to throw away.');
            void propose({ type: 'discard_changes', files: files.length === paths.length ? undefined : files });
          },
        },
        'Discard ticked…',
      ),
    ),
  );
}

function commitPanel(snapshot: RepoSnapshot, commit: Commit): HTMLElement {
  const files = state.files.get(commit.hash);
  if (!files) {
    void api.commitFiles(commit.hash).then((r) => {
      if (r.ok) {
        state.files.set(commit.hash, r.value);
        if (state.selected === commit.hash) render();
      }
    });
  }
  const current = snapshot.status.branch;
  const isHead = commit.hash === snapshot.status.headHash;
  const date = commit.date ? new Date(commit.date) : null;
  return h(
    'section',
    { class: 'panel' },
    h('h2', { class: 'commit-title' }, commit.subject),
    h('div', { class: 'commit-meta' }, `${commit.authorName} · ${date ? `${date.toLocaleString()} (${relativeTime(commit.date)})` : ''}`),
    h(
      'div',
      { class: 'commit-meta' },
      h('span', { title: lookupTerm('hash')?.short }, `Commit ${commit.shortHash}`),
      commit.parents.length > 1 ? h('span', null, ' · merge of ', h('button', { class: 'chip', type: 'button', onclick: () => openLearn('merge') }, `${commit.parents.length} lines`)) : null,
    ),
    commit.refs.length ? h('div', { class: 'row-refs panel-refs' }, commit.refs.map((r) => badge(r, () => selectRef(r, commit)))) : null,
    h('h3', null, 'Files changed'),
    files ? h('ul', { class: 'files' }, files.map((f) => fileRow(f))) : h('p', { class: 'muted' }, 'Loading…'),
    h('h3', null, 'Do something with this commit'),
    h(
      'div',
      { class: 'actions actions-column' },
      h('button', { type: 'button', onclick: () => askBranchName(`New branch starting at ${commit.shortHash}`, commit.hash) }, 'Start a branch here…'),
      !isHead ? h('button', { type: 'button', title: 'Look at the project as it was at this commit', onclick: () => propose({ type: 'switch_branch', name: commit.hash }) }, 'Look at this version (detached)') : null,
      commit.parents.length === 1 ? h('button', { type: 'button', title: lookupTerm('revert')?.short, onclick: () => propose({ type: 'revert', commit: commit.hash }) }, 'Undo it with a new commit (revert)') : null,
      commit.parents.length === 1 && !isHead
        ? h('button', { type: 'button', title: lookupTerm('cherry-pick')?.short, onclick: () => propose({ type: 'cherry_pick', commit: commit.hash }) }, `Copy it onto ${current ?? 'HEAD'} (cherry-pick)`)
        : null,
      isHead && commit.parents.length === 1 ? h('button', { type: 'button', onclick: () => propose({ type: 'undo_last_commit' }) }, 'Take back this commit, keep the changes') : null,
      h(
        'button',
        {
          type: 'button',
          onclick: async () => {
            const v = await ask(`Tag ${commit.shortHash}`, [
              { name: 'name', label: 'Tag name', placeholder: 'v1.0.0', hint: 'Tags are permanent labels, great for versions.' },
              { name: 'message', label: 'Note (optional)', placeholder: 'First public release' },
            ]);
            if (v?.name) await propose({ type: 'create_tag', name: v.name, commit: commit.hash, message: v.message || undefined });
          },
        },
        'Tag this commit…',
      ),
      !isHead
        ? h(
            'button',
            {
              class: 'danger-text',
              type: 'button',
              onclick: async () => {
                const v = await ask(`Move ${current ?? 'HEAD'} back to ${commit.shortHash}`, [
                  {
                    name: 'mode',
                    label: 'What should happen to the changes after this commit?',
                    type: 'select',
                    value: 'mixed',
                    options: [
                      { value: 'soft', label: 'Keep them, staged (soft)' },
                      { value: 'mixed', label: 'Keep them, unstaged (mixed)' },
                      { value: 'hard', label: 'Throw them away (hard)' },
                    ],
                  },
                ]);
                if (v) await propose({ type: 'reset', to: commit.hash, mode: v.mode as 'soft' | 'mixed' | 'hard' });
              },
            },
            'Move the branch back here (reset)…',
          )
        : null,
    ),
  );
}

function refPanel(snapshot: RepoSnapshot, ref: Ref, commit: Commit | undefined): HTMLElement {
  const current = snapshot.status.branch;
  const entry = lookupTerm(ref.kind === 'head' ? 'head' : ref.kind === 'remote' ? 'remote' : ref.kind);
  const actions: (HTMLElement | null)[] = [];
  if (ref.kind === 'branch') {
    if (ref.name === current) {
      actions.push(
        snapshot.remotes.length ? h('button', { type: 'button', onclick: () => propose({ type: 'push' }) }, 'Push to the remote') : null,
        snapshot.status.upstream ? h('button', { type: 'button', onclick: () => propose({ type: 'pull' }) }, 'Pull from the remote') : null,
      );
    } else {
      actions.push(
        h('button', { class: 'primary', type: 'button', onclick: () => propose({ type: 'switch_branch', name: ref.name }) }, `Switch to ${ref.name}`),
        current ? h('button', { type: 'button', onclick: () => propose({ type: 'merge', branch: ref.name }) }, `Merge ${ref.name} into ${current}`) : null,
        h('button', { class: 'danger-text', type: 'button', onclick: () => propose({ type: 'delete_branch', name: ref.name }) }, 'Delete branch…'),
      );
    }
    actions.push(
      h(
        'button',
        {
          type: 'button',
          onclick: async () => {
            const v = await ask(`Rename ${ref.name}`, [{ name: 'newName', label: 'New name', value: ref.name }]);
            if (v?.newName && v.newName !== ref.name) await propose({ type: 'rename_branch', name: ref.name, newName: v.newName });
          },
        },
        'Rename…',
      ),
    );
  } else if (ref.kind === 'remote') {
    const local = ref.name.split('/').slice(1).join('/');
    if (!snapshot.branches.includes(local)) {
      actions.push(h('button', { class: 'primary', type: 'button', onclick: () => propose({ type: 'switch_branch', name: ref.name }) }, `Get a local copy of ${local}`));
    }
    if (current) actions.push(h('button', { type: 'button', onclick: () => propose({ type: 'merge', branch: ref.name }) }, `Merge ${ref.name} into ${current}`));
  }
  return h(
    'section',
    { class: 'panel' },
    h('div', { class: 'ref-head' }, badge(ref), h('span', { class: 'muted' }, ref.kind === 'head' ? 'You are here' : ref.kind)),
    entry ? h('p', null, entry.short, ' ', h('button', { class: 'chip', type: 'button', onclick: () => openLearn(entry.id) }, 'Learn more')) : null,
    commit ? h('p', { class: 'muted' }, 'Points at ', h('button', { class: 'link', type: 'button', onclick: () => selectCommit(commit.hash) }, `${commit.shortHash} "${commit.subject}"`)) : null,
    actions.length ? h('div', { class: 'actions actions-column' }, actions) : null,
  );
}

function selectCommit(hash: string): void {
  state.selected = hash;
  state.selectedRef = null;
  state.tab = 'details';
  render();
}

function selectRef(ref: Ref, commit: Commit): void {
  state.selected = commit.hash;
  state.selectedRef = ref;
  state.tab = 'details';
  render();
}

function detailsPanel(snapshot: RepoSnapshot): HTMLElement {
  if (state.selected === WORKING_HASH && snapshot.status.changes.length) return workingPanel(snapshot);
  const commit = snapshot.commits.find((c) => c.hash === state.selected);
  if (state.selectedRef) return refPanel(snapshot, state.selectedRef, commit);
  if (commit) return commitPanel(snapshot, commit);
  return h(
    'section',
    { class: 'panel' },
    h('h2', null, 'How to read this'),
    h(
      'ul',
      { class: 'howto' },
      h('li', null, 'Each ', h('strong', null, 'dot'), ' is a commit: a saved snapshot. Newest is at the top.'),
      h('li', null, 'Lines connect a commit to the one it came from. Where lines split, someone started a ', h('button', { class: 'chip', type: 'button', onclick: () => openLearn('branch') }, 'branch'), '; where they join, it was ', h('button', { class: 'chip', type: 'button', onclick: () => openLearn('merge') }, 'merged'), '.'),
      h('li', null, 'The ringed dot with ', h('span', { class: 'badge badge-branch badge-current' }, 'your branch'), ' is ', h('button', { class: 'chip', type: 'button', onclick: () => openLearn('head') }, 'HEAD'), ': where you are.'),
      h('li', null, 'Outlined labels like ', h('span', { class: 'badge badge-remote' }, 'origin/main'), ' show where things are on GitHub (as of your last fetch).'),
      h('li', null, 'Click any dot or label to see what you can do with it. Gitpicky always shows a preview and asks before changing anything.'),
    ),
  );
}

function sidebar(snapshot: RepoSnapshot): HTMLElement {
  const tab = (id: Tab, label: string) =>
    h(
      'button',
      {
        class: `tab${state.tab === id ? ' active' : ''}`,
        type: 'button',
        onclick: () => {
          state.tab = id;
          render();
        },
      },
      label,
    );
  return h(
    'aside',
    { class: 'sidebar' },
    h('nav', { class: 'tabs' }, tab('details', 'Details'), tab('learn', 'Learn')),
    h(
      'div',
      { class: 'sidebar-body' },
      state.tab === 'details' ? detailsPanel(snapshot) : renderLearn(state.learn, render),
    ),
  );
}

function render(): void {
  const scroller = document.querySelector('.history');
  const scrollTop = scroller?.scrollTop ?? 0;
  const sidebarScroll = document.querySelector('.sidebar-body')?.scrollTop ?? 0;
  clear(root);
  const snapshot = state.snapshot;
  root.appendChild(header(snapshot));
  if (!snapshot) {
    root.appendChild(welcome());
    return;
  }
  const commits = displayCommits(snapshot);
  const history = h(
    'main',
    { class: `history${state.preview ? ' previewing' : ''}` },
    commits.length
      ? renderGraph(commits, state.selected, {
          onSelectCommit: selectCommit,
          onSelectRef: selectRef,
        })
      : h('div', { class: 'empty' }, h('h2', null, 'No commits yet'), h('p', null, 'This repository is brand new. Make your first commit to start the history.')),
  );
  root.appendChild(
    h('div', { class: 'body' }, h('div', { class: 'history-wrap' }, inProgressBanner(snapshot), state.preview ? h('div', { class: 'preview-banner' }, 'Preview: this is how the history will look if you approve.') : null, history), sidebar(snapshot)),
  );
  root.appendChild(statusBar(snapshot));
  history.scrollTop = scrollTop;
  const body = document.querySelector('.sidebar-body');
  if (body) body.scrollTop = sidebarScroll;
}

// ---------------------------------------------------------------- start

async function start(): Promise<void> {
  state.recent = await api.recentRepos();
  api.onRepoChanged(() => {
    if (!state.preview) void refresh();
  });
  const initial = await api.refresh();
  if (initial) await load(Promise.resolve(initial));
  else render();
}

void start();
