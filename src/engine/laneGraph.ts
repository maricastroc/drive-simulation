import type { ConnectionId, LaneId, NodeId } from './types';

/**
 * A permitted lane -> lane movement through a node.
 *
 * `rank` (strict priority, unique per node) and `conflicts` (indices of connections whose path
 * crosses or merges with this one) drive the intersection gap-acceptance (design doc §J).
 */
export interface Connection {
  readonly fromLane: LaneId;
  readonly toLane: LaneId;
  readonly length: number; // distance crossing the node (m)
  readonly rank: number; // strict priority (unique per node)
  readonly conflicts: readonly ConnectionId[];
}

/**
 * Static road network (design doc §C). Immutable during a run. Metric/topological only:
 * rendering geometry lives in the render layer, never here.
 */
export interface LaneGraph {
  readonly laneCount: number;
  readonly length: Float32Array; // per lane: length (m)
  readonly speedLimit: Float32Array; // per lane: speed limit (m/s)
  readonly fromNode: Int32Array; // per lane: origin node
  readonly toNode: Int32Array; // per lane: destination node
  readonly connStart: Int32Array; // per lane: first index into `connections`
  readonly connEnd: Int32Array; // per lane: one-past-last index into `connections`
  readonly connections: readonly Connection[];
}

export interface LaneSpec {
  readonly length: number;
  readonly speedLimit: number; // m/s
  readonly fromNode: NodeId;
  readonly toNode: NodeId;
}

export interface ConnectionSpec {
  readonly fromLane: LaneId;
  readonly toLane: LaneId;
  readonly length?: number;
  readonly rank?: number;
  readonly conflicts?: readonly ConnectionId[]; // conflicting connections, by index
  readonly conflictsWith?: readonly (readonly [LaneId, LaneId])[]; // conflicting movements, by (from,to)
}

/**
 * Build the immutable LaneGraph (typed arrays + CSR connections) from a plain description.
 * Conflicts may be given by connection index (`conflicts`) or, more conveniently for a generator,
 * by the (from, to) lane pair of the conflicting movement (`conflictsWith`) — resolved here.
 */
export function buildLaneGraph(
  lanes: readonly LaneSpec[],
  connections: readonly ConnectionSpec[] = [],
): LaneGraph {
  const laneCount = lanes.length;
  const length = new Float32Array(laneCount);
  const speedLimit = new Float32Array(laneCount);
  const fromNode = new Int32Array(laneCount);
  const toNode = new Int32Array(laneCount);

  for (let i = 0; i < laneCount; i++) {
    const lane = lanes[i];
    length[i] = lane.length;
    speedLimit[i] = lane.speedLimit;
    fromNode[i] = lane.fromNode;
    toNode[i] = lane.toNode;
  }

  // Group connection specs by fromLane so they can be indexed CSR-style.
  const byLane: ConnectionSpec[][] = Array.from({ length: laneCount }, () => []);
  for (const c of connections) {
    if (c.fromLane < 0 || c.fromLane >= laneCount) {
      throw new Error(`Connection.fromLane out of range: ${c.fromLane}`);
    }
    if (c.toLane < 0 || c.toLane >= laneCount) {
      throw new Error(`Connection.toLane out of range: ${c.toLane}`);
    }
    byLane[c.fromLane].push(c);
  }

  // First pass: lay out specs CSR-style and index them by (from, to).
  const connStart = new Int32Array(laneCount);
  const connEnd = new Int32Array(laneCount);
  const flat: ConnectionSpec[] = [];
  const indexOf = new Map<number, number>();
  const key = (from: number, to: number) => from * laneCount + to;
  for (let lane = 0; lane < laneCount; lane++) {
    connStart[lane] = flat.length;
    for (const c of byLane[lane]) {
      indexOf.set(key(c.fromLane, c.toLane), flat.length);
      flat.push(c);
    }
    connEnd[lane] = flat.length;
  }

  // Second pass: resolve conflicts (index-based and (from,to)-based) into a flat index list.
  const connections2: Connection[] = flat.map((c) => {
    const conflicts = [...(c.conflicts ?? [])];
    for (const [from, to] of c.conflictsWith ?? []) {
      const idx = indexOf.get(key(from, to));
      if (idx === undefined) throw new Error(`conflictsWith references missing movement ${from}->${to}`);
      conflicts.push(idx);
    }
    return {
      fromLane: c.fromLane,
      toLane: c.toLane,
      length: c.length ?? 0,
      rank: c.rank ?? 0,
      conflicts,
    };
  });

  return { laneCount, length, speedLimit, fromNode, toNode, connStart, connEnd, connections: connections2 };
}
