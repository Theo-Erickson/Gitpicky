import { describe, expect, it } from 'vitest';
import { layoutGraph, renderAsciiGraph } from '../src/core/graph';

const c = (hash: string, ...parents: string[]) => ({ hash, parents });

describe('layoutGraph', () => {
  it('keeps a straight history in one lane', () => {
    const g = layoutGraph([c('c', 'b'), c('b', 'a'), c('a')]);
    expect(g.nodes.map((n) => n.lane)).toEqual([0, 0, 0]);
    expect(g.laneCount).toBe(1);
    expect(g.segments).toEqual([
      { x1: 0, y1: 0, x2: 0, y2: 1, color: 0 },
      { x1: 0, y1: 1, x2: 0, y2: 2, color: 0 },
    ]);
  });

  it('opens a second lane for a merge and closes it again', () => {
    // m merges f into b; both come from a.
    const g = layoutGraph([c('m', 'b', 'f'), c('f', 'a'), c('b', 'a'), c('a')]);
    const lanes = Object.fromEntries(g.nodes.map((n) => [n.hash, n.lane]));
    expect(lanes).toEqual({ m: 0, f: 1, b: 0, a: 0 });
    expect(g.nodes[0].merge).toBe(true);
    expect(g.laneCount).toBe(2);
    // The feature line curves back into lane 0 at commit a.
    expect(g.segments).toContainEqual({ x1: 1, y1: 2, x2: 0, y2: 3, color: 1 });
    // The merge line leaves the merge commit toward lane 1.
    expect(g.segments).toContainEqual({ x1: 0, y1: 0, x2: 1, y2: 1, color: 1 });
  });

  it('gives each unmerged branch tip its own lane and color', () => {
    const g = layoutGraph([c('x', 'a'), c('y', 'a'), c('a')]);
    expect(g.nodes[0].lane).toBe(0);
    expect(g.nodes[1].lane).toBe(1);
    expect(g.nodes[0].color).not.toBe(g.nodes[1].color);
    expect(g.nodes[2].lane).toBe(0);
  });

  it('lets lines with missing parents run off the bottom', () => {
    const g = layoutGraph([c('b', 'a')]);
    expect(g.segments).toEqual([{ x1: 0, y1: 0, x2: 0, y2: 1, color: 0 }]);
  });

  it('draws a readable ascii version', () => {
    const text = renderAsciiGraph([c('m', 'b', 'f'), c('f', 'a'), c('b', 'a'), c('a')]);
    expect(text.split('\n')).toEqual(['M    m', '| *  f', '* |  b', '*    a']);
  });
});
