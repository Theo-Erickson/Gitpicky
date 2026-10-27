// The recent-repositories dropdown under the repository name, and the same
// list on the welcome screen.

import type { RecentRepo } from '../app/api';
import { h, relativeTime } from './dom';

export interface PickerState {
  open: boolean;
  query: string;
  /** Index of the highlighted row (keyboard navigation). */
  active: number;
}

export interface PickerActions {
  open(path: string): void;
  forget(path: string): void;
  browse(): void;
  close(): void;
}

export const isMac = navigator.platform.toLowerCase().includes('mac');
export const OPEN_SHORTCUT = isMac ? '⌘O' : 'Ctrl+O';
export const BROWSE_SHORTCUT = isMac ? '⇧⌘O' : 'Ctrl+Shift+O';

/** Shortens a path for display: the home folder becomes ~ and the middle is trimmed if long. */
export function shortPath(path: string): string {
  const home = path.match(/^([A-Za-z]:\\Users\\[^\\]+|\/Users\/[^/]+|\/home\/[^/]+)/)?.[1];
  const p = home ? `~${path.slice(home.length)}` : path;
  return p.length > 58 ? `${p.slice(0, 20)}…${p.slice(-35)}` : p;
}

export function filterRecent(list: RecentRepo[], query: string): RecentRepo[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((r) => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q));
}

function row(repo: RecentRepo, active: boolean, actions: PickerActions): HTMLElement {
  const meta = repo.exists
    ? [repo.branch ? h('span', { class: 'picker-branch' }, repo.branch) : null, repo.lastOpened ? h('span', { class: 'picker-when' }, `opened ${relativeTime(repo.lastOpened)}`) : null]
    : [h('span', { class: 'picker-missing' }, 'Folder not found')];
  return h(
    'div',
    {
      class: `picker-row${active ? ' active' : ''}${repo.current ? ' current' : ''}${repo.exists ? '' : ' missing'}`,
      role: 'option',
      'aria-selected': active ? 'true' : 'false',
      title: repo.path,
      onclick: () => repo.exists && actions.open(repo.path),
    },
    h('span', { class: 'picker-check', 'aria-hidden': 'true' }, repo.current ? '✓' : ''),
    h(
      'span',
      { class: 'picker-text' },
      h('span', { class: 'picker-name' }, repo.name, ...meta.filter(Boolean).map((m) => [' ', m])),
      h('span', { class: 'picker-path' }, shortPath(repo.path)),
    ),
    repo.current
      ? null
      : h(
          'button',
          {
            class: 'picker-forget',
            type: 'button',
            title: 'Remove from this list (the folder is not touched)',
            'aria-label': `Remove ${repo.name} from recent repositories`,
            onclick: (e: MouseEvent) => {
              e.stopPropagation();
              actions.forget(repo.path);
            },
          },
          '×',
        ),
  );
}

/** The dropdown. Rendered while state.open is true. */
export function renderPicker(list: RecentRepo[], state: PickerState, actions: PickerActions): HTMLElement {
  const rows = h('div', { class: 'picker-rows' });
  const drawRows = () => {
    const shown = filterRecent(list, state.query);
    rows.replaceChildren(
      shown.length
        ? h('div', { class: 'picker-list' }, shown.map((r, i) => row(r, i === state.active, actions)))
        : h('p', { class: 'picker-empty' }, list.length ? 'No matches.' : 'Repositories you open will be listed here.'),
      h(
        'button',
        { class: `picker-browse${state.active === shown.length ? ' active' : ''}`, type: 'button', onclick: () => actions.browse() },
        h('span', null, 'Browse all repositories…'),
        h('kbd', null, BROWSE_SHORTCUT),
      ),
    );
  };
  const search =
    list.length > 5
      ? h('input', {
          type: 'search',
          class: 'picker-search',
          placeholder: 'Filter recent repositories',
          value: state.query,
          'aria-label': 'Filter recent repositories',
        })
      : null;
  search?.addEventListener('input', () => {
    state.query = search.value;
    state.active = 0;
    drawRows();
  });
  drawRows();
  const panel = h(
    'div',
    { class: 'picker', role: 'listbox', 'aria-label': 'Recent repositories' },
    search,
    h('div', { class: 'picker-heading' }, 'Recent'),
    rows,
    h('p', { class: 'picker-hint' }, 'Tip: drop a folder on the window to open it.'),
  );
  return h('div', { class: 'picker-layer', onclick: (e: MouseEvent) => e.target === e.currentTarget && actions.close() }, panel);
}

/** Keyboard handling while the dropdown is open. Returns true if the key was used. */
export function pickerKey(e: KeyboardEvent, list: RecentRepo[], state: PickerState, actions: PickerActions): boolean {
  const shown = filterRecent(list, state.query);
  const last = shown.length; // the "Open another folder…" row
  if (e.key === 'Escape') {
    actions.close();
    return true;
  }
  if (e.key === 'ArrowDown') {
    state.active = Math.min(last, state.active + 1);
    return true;
  }
  if (e.key === 'ArrowUp') {
    state.active = Math.max(0, state.active - 1);
    return true;
  }
  if (e.key === 'Enter') {
    if (state.active >= last) actions.browse();
    else if (shown[state.active]?.exists) actions.open(shown[state.active].path);
    return true;
  }
  return false;
}

/** The recent list as cards, for the welcome screen. */
export function renderRecentCards(list: RecentRepo[], actions: Pick<PickerActions, 'open' | 'forget'>): HTMLElement | null {
  if (!list.length) return null;
  const all: PickerActions = { ...actions, browse: () => undefined, close: () => undefined };
  return h(
    'div',
    { class: 'recent' },
    h('h3', null, 'Recent repositories'),
    h('div', { class: 'picker-list recent-list' }, list.map((r) => row(r, false, all))),
  );
}
