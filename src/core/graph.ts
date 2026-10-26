// Turns a topologically ordered commit list (newest first) into lanes and line
// segments that can be drawn as a "subway map" of the history.
//
// The idea: walk the commits top to bottom while keeping a list of lanes. Each
// lane remembers which commit it is waiting for next. When a commit arrives it
// takes over the lane waiting for it (or a fresh one), then hands its lane down
// to its first parent and opens extra lanes for any other parents (merges).

export interface GraphInputCommit {
  hash: string;
  parents: string[];
}

export interface GraphNode {
  hash: string;
  row: number;
  lane: number;
  color: number;
  /** True for merge commits (more than one parent). */
  merge: boolean;
}

export interface GraphSegment {
  /** Lane and row where the line starts (rows are commit centers). */
  x1: number;
  y1: number;
  /** Lane and row where the line ends. y2 is always y1 + 1. */
  x2: number;
  y2: number;
  color: number;
}

export interface GraphLayout {
  nodes: GraphNode[];
  segments: GraphSegment[];
  laneCount: number;
}

export function layoutGraph(commits: GraphInputCommit[]): GraphLayout {
  const nodes: GraphNode[] = [];
  const segments: GraphSegment[] = [];
  // What each lane is waiting for, and where the line feeding it starts on the previous row.
  let lanes: (string | null)[] = [];
  let sources: number[][] = [];
  let laneColor: number[] = [];
  let nextColor = 0;
  let laneCount = 0;

  const freeLane = (): number => {
    const idx = lanes.indexOf(null);
    if (idx !== -1) return idx;
    lanes.push(null);
    sources.push([]);
    laneColor.push(0);
    return lanes.length - 1;
  };

  commits.forEach((commit, row) => {
    // 1. Which lanes were waiting for this commit?
    const waiting: number[] = [];
    lanes.forEach((h, j) => {
      if (h === commit.hash) waiting.push(j);
    });

    let lane: number;
    if (waiting.length > 0) {
      lane = waiting[0];
    } else {
      // A branch tip nobody was waiting for: start a new line with a new color.
      lane = freeLane();
      laneColor[lane] = nextColor++;
    }
    const color = laneColor[lane];

    // 2. Draw the lines coming into this row from the row above.
    if (row > 0) {
      lanes.forEach((h, j) => {
        if (h === null) return;
        const x2 = h === commit.hash ? lane : j;
        for (const x1 of sources[j]) {
          segments.push({ x1, y1: row - 1, x2, y2: row, color: laneColor[j] });
        }
      });
    }

    // 3. Lanes that converged into this commit are free again.
    for (const j of waiting) {
      lanes[j] = null;
      sources[j] = [];
    }
    // Lanes not touched by this commit keep running straight down.
    lanes.forEach((h, j) => {
      if (h !== null) sources[j] = [j];
    });

    // 4. Hand the lane to the parents.
    const [first, ...others] = commit.parents;
    if (first !== undefined) {
      // Keep going straight down, even if another lane also waits for this parent;
      // the two lines meet when the parent arrives.
      lanes[lane] = first;
      sources[lane] = [lane];
      laneColor[lane] = color;
    }
    for (const parent of others) {
      const existing = lanes.indexOf(parent);
      if (existing !== -1) {
        sources[existing].push(lane);
      } else {
        const j = freeLane();
        lanes[j] = parent;
        sources[j] = [lane];
        laneColor[j] = nextColor++;
      }
    }

    nodes.push({ hash: commit.hash, row, lane, color, merge: commit.parents.length > 1 });
    laneCount = Math.max(laneCount, lanes.length, lane + 1);

    // Trim empty lanes on the right so the picture stays narrow.
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop();
      sources.pop();
      laneColor.pop();
    }
  });

  // History was cut off: let lines whose parents we never saw run off the bottom.
  const lastRow = commits.length - 1;
  if (lastRow >= 0) {
    lanes.forEach((h, j) => {
      if (h === null) return;
      for (const x1 of sources[j]) {
        segments.push({ x1, y1: lastRow, x2: j, y2: lastRow + 1, color: laneColor[j] });
      }
    });
  }

  return { nodes, segments, laneCount: Math.max(laneCount, 1) };
}

/** A small text drawing of the graph, used by the MCP server so assistants can "see" it too. */
export function renderAsciiGraph(
  commits: (GraphInputCommit & { shortHash?: string; label?: string })[],
): string {
  const layout = layoutGraph(commits);
  const width = layout.laneCount;
  const lines: string[] = [];
  layout.nodes.forEach((node, i) => {
    const row = new Array<string>(width).fill(' ');
    // Lines passing through this row.
    for (const s of layout.segments) {
      if (s.y2 === node.row && s.x2 !== node.lane && s.x1 === s.x2) row[s.x2] = '|';
    }
    row[node.lane] = node.merge ? 'M' : '*';
    const c = commits[i];
    lines.push(`${row.join(' ').trimEnd().padEnd(width * 2)} ${c.shortHash ?? c.hash.slice(0, 7)} ${c.label ?? ''}`.trimEnd());
  });
  return lines.join('\n');
}
