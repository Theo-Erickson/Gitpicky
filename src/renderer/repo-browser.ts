// The repository browser: every repository found in the folders you keep
// projects in, grouped by folder, with search and keyboard navigation.

import type { BrowseRepo, BrowseResult, RecentRepo } from '../app/api';
import { h, relativeTime } from './dom';
import { shortPath } from './repo-picker';

export interface BrowserState {
  open: boolean;
  loading: boolean;
  result: BrowseResult | null;
  query: string;
  /** Show only this scan folder ('' for all). */
  root: string;
  /** Index into the visible list (keyboard navigation). */
  active: number;
}

export interface BrowserActions {
  open(path: string): void;
  chooseFolder(): void;
  addRoot(): void;
  removeRoot(path: string): void;
  pickRoot(path: string): void;
  close(): void;
}

export function newBrowserState(): BrowserState {
  return { open: false, loading: false, result: null, query: '', root: '', active: 0 };
}

interface Group {
  title: string;
  hint?: string;
  repos: BrowseRepo[];
}

function matches(r: { name: string; path: string; branch: string | null }, q: string): boolean {
  return !q || r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q) || (r.branch ?? '').toLowerCase().includes(q);
}

/** The groups currently shown, in order: recent first, then each scan folder. */
export function visibleGroups(state: BrowserState, recent: RecentRepo[]): Group[] {
  const q = state.query.trim().toLowerCase();
  const found = state.result?.repos ?? [];
  const groups: Group[] = [];
  if (!state.root) {
    const byPath = new Map(found.map((r) => [r.path.toLowerCase(), r]));
    const recentRepos: BrowseRepo[] = recent
      .filter((r) => r.exists)
      .map(
        (r) =>
          byPath.get(r.path.toLowerCase()) ?? {
            path: r.path,
            name: r.name,
            root: '',
            branch: r.branch,
            lastActivity: '',
            recent: true,
            current: r.current,
          },
      )
      .filter((r) => matches(r, q))
      .slice(0, q ? 12 : 5);
    if (recentRepos.length) groups.push({ title: 'Recent', repos: recentRepos });
  }
  for (const root of state.result?.roots ?? []) {
    if (state.root && root !== state.root) continue;
    const repos = found.filter((r) => r.root === root && matches(r, q));
    if (repos.length) groups.push({ title: root.split(/[\\/]/).filter(Boolean).pop() ?? root, hint: shortPath(root), repos });
  }
  return groups;
}

export function visibleRepos(state: BrowserState, recent: RecentRepo[]): BrowseRepo[] {
  return visibleGroups(state, recent).flatMap((g) => g.repos);
}

function relativeIn(repo: BrowseRepo): string {
  if (!repo.root) return shortPath(repo.path);
  const rest = repo.path.slice(repo.root.length).replace(/^[\\/]/, '');
  const parent = rest.split(/[\\/]/).slice(0, -1).join('/');
  return parent ? `${parent}/` : '';
}

export function renderBrowser(state: BrowserState, recent: RecentRepo[], actions: BrowserActions): HTMLElement {
  const result = state.result;
  const counts = new Map<string, number>();
  for (const r of result?.repos ?? []) counts.set(r.root, (counts.get(r.root) ?? 0) + 1);

  const search = h('input', {
    type: 'search',
    class: 'browser-search',
    placeholder: 'Search by name, folder or branch',
    value: state.query,
    'aria-label': 'Search repositories',
  });

  const list = h('div', { class: 'browser-list', role: 'listbox', 'aria-label': 'Repositories' });
  const drawList = () => {
    if (state.loading && !result) {
      list.replaceChildren(h('p', { class: 'browser-empty' }, 'Looking for repositories…'));
      return;
    }
    const groups = visibleGroups(state, recent);
    if (!groups.length) {
      list.replaceChildren(
        h(
          'div',
          { class: 'browser-empty' },
          h('p', null, state.query ? `Nothing matches "${state.query}".` : 'No repositories found in these folders yet.'),
          h('p', { class: 'muted' }, 'Add the folder you keep your projects in, or choose a repository folder directly.'),
        ),
      );
      return;
    }
    let index = 0;
    list.replaceChildren(
      ...groups.map((g) =>
        h(
          'section',
          { class: 'browser-group' },
          h('h4', null, g.title, g.hint ? h('span', null, g.hint) : null),
          g.repos.map((r) => {
            const i = index++;
            return h(
              'div',
              {
                class: `browser-row${i === state.active ? ' active' : ''}${r.current ? ' current' : ''}`,
                role: 'option',
                'aria-selected': i === state.active ? 'true' : 'false',
                title: r.path,
                onclick: () => actions.open(r.path),
              },
              h('span', { class: 'picker-check', 'aria-hidden': 'true' }, r.current ? '✓' : ''),
              h(
                'span',
                { class: 'picker-text' },
                h(
                  'span',
                  { class: 'picker-name' },
                  r.name,
                  r.branch ? h('span', { class: 'picker-branch' }, r.branch) : null,
                  r.recent && g.title !== 'Recent' ? h('span', { class: 'browser-tag' }, 'recent') : null,
                ),
                h('span', { class: 'picker-path' }, relativeIn(r)),
              ),
              h('span', { class: 'picker-when' }, r.lastActivity ? relativeTime(r.lastActivity) : ''),
            );
          }),
        ),
      ),
    );
  };
  search.addEventListener('input', () => {
    state.query = search.value;
    state.active = 0;
    drawList();
  });
  drawList();

  const rootItem = (path: string, label: string, hint: string | null, count: number | null) =>
    h(
      'div',
      { class: `browser-root${state.root === path ? ' active' : ''}`, onclick: () => actions.pickRoot(path), title: path || 'Every folder' },
      h('span', { class: 'browser-root-text' }, h('span', null, label), hint ? h('small', null, hint) : null),
      count !== null ? h('span', { class: 'browser-count' }, String(count)) : null,
      path
        ? h(
            'button',
            {
              class: 'picker-forget',
              type: 'button',
              title: 'Stop looking in this folder (nothing is deleted)',
              'aria-label': `Stop scanning ${label}`,
              onclick: (e: MouseEvent) => {
                e.stopPropagation();
                actions.removeRoot(path);
              },
            },
            '×',
          )
        : null,
    );

  const panel = h(
    'div',
    { class: 'browser', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Open a repository' },
    h(
      'div',
      { class: 'browser-head' },
      h('h2', null, 'Open a repository'),
      search,
      h('button', { class: 'browser-close', type: 'button', 'aria-label': 'Close', onclick: () => actions.close() }, '×'),
    ),
    h(
      'div',
      { class: 'browser-body' },
      h(
        'aside',
        { class: 'browser-roots' },
        h('h4', null, 'Your project folders'),
        rootItem('', 'All folders', null, result ? result.repos.length : null),
        (result?.roots ?? []).map((r) => rootItem(r, r.split(/[\\/]/).filter(Boolean).pop() ?? r, shortPath(r), counts.get(r) ?? 0)),
        h('button', { class: 'browser-add', type: 'button', onclick: () => actions.addRoot() }, '+ Add a folder…'),
        result?.suggested ? h('p', { class: 'browser-note' }, 'Found these folders automatically. Add or remove any.') : null,
        h('p', { class: 'browser-note' }, 'Gitpicky looks up to 3 folders deep.'),
        h('div', { class: 'browser-spacer' }),
        h('button', { class: 'browser-choose', type: 'button', onclick: () => actions.chooseFolder() }, 'Choose a repository folder…'),
      ),
      list,
    ),
  );
  requestAnimationFrame(() => {
    search.focus();
    search.setSelectionRange(search.value.length, search.value.length);
    list.querySelector('.browser-row.active')?.scrollIntoView({ block: 'nearest' });
  });
  return h('div', { class: 'overlay browser-overlay', onclick: (e: MouseEvent) => e.target === e.currentTarget && actions.close() }, panel);
}

/** Keyboard handling while the browser is open. Returns true if the key was used. */
export function browserKey(e: KeyboardEvent, state: BrowserState, recent: RecentRepo[], actions: BrowserActions): boolean {
  const shown = visibleRepos(state, recent);
  if (e.key === 'Escape') {
    actions.close();
    return true;
  }
  if (e.key === 'ArrowDown') {
    state.active = Math.min(shown.length - 1, state.active + 1);
    return true;
  }
  if (e.key === 'ArrowUp') {
    state.active = Math.max(0, state.active - 1);
    return true;
  }
  if (e.key === 'Enter' && shown[state.active]) {
    actions.open(shown[state.active].path);
    return true;
  }
  return false;
}
