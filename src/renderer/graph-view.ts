import { lookupTerm } from '../core/glossary';
import { layoutGraph } from '../core/graph';
import type { Commit, Ref } from '../core/types';
import { h, relativeTime, svg } from './dom';

export const ROW_HEIGHT = 34;
const LANE_WIDTH = 18;
const GRAPH_PAD = 14;
export const WORKING_HASH = 'WORKING';

export interface GraphViewHandlers {
  onSelectCommit(hash: string): void;
  onSelectRef(ref: Ref, commit: Commit): void;
}

const laneX = (lane: number) => GRAPH_PAD + lane * LANE_WIDTH;
const rowY = (row: number) => row * ROW_HEIGHT + ROW_HEIGHT / 2;

export function refTooltip(ref: Ref): string {
  switch (ref.kind) {
    case 'head':
      return `HEAD: ${lookupTerm('head')?.short ?? ''}`;
    case 'tag':
      return `Tag: ${lookupTerm('tag')?.short ?? ''}`;
    case 'remote':
      return `Remote branch: where "${ref.name}" was on the remote the last time you fetched.`;
    default:
      return ref.current
        ? `Branch "${ref.name}" (you are on it): new commits will be added here.`
        : `Branch "${ref.name}": ${lookupTerm('branch')?.short ?? ''}`;
  }
}

export function badge(ref: Ref, onClick?: () => void): HTMLElement {
  const classes = ['badge', `badge-${ref.kind}`];
  if (ref.current) classes.push('badge-current');
  return h(
    'button',
    {
      class: classes.join(' '),
      title: refTooltip(ref),
      type: 'button',
      onclick: (e: MouseEvent) => {
        e.stopPropagation();
        onClick?.();
      },
    },
    ref.kind === 'head' ? 'HEAD' : ref.name,
  );
}

/** Renders the commit list with the graph drawn alongside it. */
export function renderGraph(commits: Commit[], selected: string | null, handlers: GraphViewHandlers): HTMLElement {
  const layout = layoutGraph(commits);
  const graphWidth = GRAPH_PAD * 2 + (layout.laneCount - 1) * LANE_WIDTH;
  const height = commits.length * ROW_HEIGHT;

  const drawing = svg('svg', {
    class: 'graph-svg',
    width: graphWidth,
    height: height + ROW_HEIGHT,
    viewBox: `0 0 ${graphWidth} ${height + ROW_HEIGHT}`,
    'aria-hidden': 'true',
  });

  const previewHashes = new Set(commits.filter((c) => c.preview).map((c) => c.hash));

  for (const s of layout.segments) {
    const x1 = laneX(s.x1);
    const y1 = rowY(s.y1);
    const x2 = laneX(s.x2);
    const y2 = rowY(s.y2);
    let d: string;
    if (x1 === x2) {
      d = `M${x1} ${y1} L${x2} ${y2}`;
    } else {
      const mid = y1 + ROW_HEIGHT * 0.55;
      d = `M${x1} ${y1} C${x1} ${mid}, ${x2} ${y2 - ROW_HEIGHT * 0.45}, ${x2} ${y2}`;
    }
    const fromCommit = commits[s.y1];
    const ghost = fromCommit && (previewHashes.has(fromCommit.hash) || fromCommit.hash === WORKING_HASH);
    drawing.appendChild(
      svg('path', {
        d,
        class: `edge lane-${s.color % 8}${ghost ? ' edge-ghost' : ''}`,
      }),
    );
  }

  for (const node of layout.nodes) {
    const commit = commits[node.row];
    const cx = laneX(node.lane);
    const cy = rowY(node.row);
    const isHead = commit.refs.some((r) => r.kind === 'head');
    const isGhost = commit.preview || commit.hash === WORKING_HASH;
    const group = svg('g', { class: `node lane-${node.color % 8}${isGhost ? ' node-ghost' : ''}${commit.hash === selected ? ' node-selected' : ''}` });
    if (isHead) group.appendChild(svg('circle', { cx, cy, r: 9.5, class: 'node-head-ring' }));
    group.appendChild(svg('circle', { cx, cy, r: node.merge ? 6.5 : 5.5, class: 'node-dot' }));
    if (node.merge) group.appendChild(svg('circle', { cx, cy, r: 2.5, class: 'node-merge-core' }));
    drawing.appendChild(group);
  }

  const rows = commits.map((commit) => {
    const isWorking = commit.hash === WORKING_HASH;
    const refs = commit.refs.filter((r) => r.kind !== 'head' || !commit.refs.some((x) => x.current));
    return h(
      'div',
      {
        class: `row${commit.hash === selected ? ' row-selected' : ''}${commit.preview ? ' row-preview' : ''}${isWorking ? ' row-working' : ''}`,
        dataset: { hash: commit.hash },
        style: `height:${ROW_HEIGHT}px;padding-left:${graphWidth + 6}px`,
        onclick: () => handlers.onSelectCommit(commit.hash),
        role: 'button',
        tabindex: 0,
      },
      h(
        'div',
        { class: 'row-refs' },
        refs.map((ref) => {
          // "HEAD -> main" is shown as one highlighted badge instead of two.
          if (ref.kind === 'branch' && ref.current) {
            return badge({ ...ref }, () => handlers.onSelectRef(ref, commit));
          }
          return badge(ref, () => handlers.onSelectRef(ref, commit));
        }),
        commit.preview ? h('span', { class: 'badge badge-preview', title: 'This commit will exist after you approve the change.' }, 'preview') : null,
      ),
      h('div', { class: 'row-subject', title: commit.subject }, commit.subject),
      h('div', { class: 'row-author' }, commit.authorName),
      h('div', { class: 'row-date', title: commit.date }, relativeTime(commit.date)),
      h('div', { class: 'row-hash' }, isWorking ? '' : commit.preview ? 'new' : commit.shortHash),
    );
  });

  return h('div', { class: 'graph', style: `min-height:${height}px` }, drawing, ...rows);
}
