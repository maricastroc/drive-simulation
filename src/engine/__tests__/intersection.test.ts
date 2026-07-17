import { describe, it, expect } from 'vitest';
import {
  buildLaneGraph,
  createWorld,
  tick,
  allocAgent,
  pushBack,
  nextConnection,
  mustYield,
  NONE,
  EPS,
  type World,
} from '../index';

// A priority crossing. Lanes: 0 = A (major in), 1 = C (major out),
//                             2 = B (minor in), 3 = D (minor out).
// A->C (rank 2) and B->D (rank 1) cross at the node and conflict.
// Connection build order groups by fromLane, so A->C is index 0 and B->D is index 1.
function crossing() {
  return buildLaneGraph(
    [
      { length: 100, speedLimit: 16, fromNode: 0, toNode: 1 }, // A
      { length: 100, speedLimit: 16, fromNode: 1, toNode: 2 }, // C (sink)
      { length: 100, speedLimit: 16, fromNode: 3, toNode: 1 }, // B
      { length: 100, speedLimit: 16, fromNode: 1, toNode: 4 }, // D (sink)
    ],
    [
      { fromLane: 0, toLane: 1, rank: 2, conflicts: [1] }, // A->C major (index 0)
      { fromLane: 2, toLane: 3, rank: 1, conflicts: [0] }, // B->D minor (index 1)
    ],
  );
}

function put(world: World, lane: number, s: number, v: number): number {
  const id = allocAgent(world.agents);
  world.agents.s[id] = s;
  world.agents.v[id] = v;
  world.agents.type[id] = 0;
  world.agents.enterTime[id] = world.time;
  pushBack(world.agents, world.occ, lane, id);
  return id;
}

function noOverlap(world: World, lane: number): boolean {
  const { agents, occ, vparams } = world;
  let prev = NONE;
  for (let id = occ.head[lane]; id !== NONE; id = agents.behind[id]) {
    if (prev !== NONE) {
      const gap = agents.s[prev] - agents.s[id] - vparams[agents.type[prev]].length;
      if (gap < -EPS) return false;
    }
    prev = id;
  }
  return true;
}

describe('intersection: nextConnection', () => {
  it('returns the single outgoing connection, or NONE for a sink lane', () => {
    const w = createWorld(crossing(), 32);
    expect(nextConnection(w, 0)).not.toBe(NONE); // A has A->C
    expect(nextConnection(w, 1)).toBe(NONE); // C is a sink
    expect(nextConnection(w, 2)).not.toBe(NONE); // B has B->D
    expect(nextConnection(w, 3)).toBe(NONE); // D is a sink
  });
});

describe('intersection: strict-priority gap acceptance', () => {
  it('the minor road yields only when a major car is approaching', () => {
    const w = createWorld(crossing(), 32);
    const bConn = nextConnection(w, 2);

    put(w, 2, 99, 2); // a B car at the end of its lane
    expect(mustYield(w, bConn)).toBe(false); // no major traffic -> go

    put(w, 0, 90, 14); // a fast A car near the junction (tta ~0.7s < T_SAFE)
    expect(mustYield(w, bConn)).toBe(true); // major approaching -> yield
  });

  it('the major road never yields to the minor road', () => {
    const w = createWorld(crossing(), 32);
    put(w, 0, 99, 5); // A car
    put(w, 2, 99, 14); // fast B car right at the junction
    expect(mustYield(w, nextConnection(w, 0))).toBe(false); // A (rank 2) ignores B (rank 1)
  });
});

describe('intersection: lane transition (moveToLane)', () => {
  it('a car with no conflict crosses A->C and completes its trip', () => {
    const w = createWorld(crossing(), 32);
    put(w, 0, 0, 0); // one A car, no B traffic

    let sawOnC = false;
    for (let n = 0; n < 200; n++) {
      tick(w);
      if (w.occ.head[1] !== NONE) sawOnC = true;
    }
    expect(sawOnC).toBe(true); // it transitioned onto C
    expect(w.metrics.completedTrips).toBe(1); // and finished
  });
});

describe('intersection: whole junction under demand', () => {
  const build = (seed: number) => {
    const w = createWorld(crossing(), 64, undefined, seed);
    w.demand.push({ lane: 0, rate: 0.35 }); // major
    w.demand.push({ lane: 2, rate: 0.45 }); // minor
    return w;
  };

  it('both movements flow with no overlap on any lane', () => {
    const w = build(42);
    let sawC = false;
    let sawD = false;
    for (let n = 0; n < 900; n++) {
      tick(w);
      if (w.occ.head[1] !== NONE) sawC = true;
      if (w.occ.head[3] !== NONE) sawD = true;
      for (let lane = 0; lane < 4; lane++) expect(noOverlap(w, lane)).toBe(true);
    }
    expect(sawC).toBe(true); // A->C happened
    expect(sawD).toBe(true); // B->D happened (minor road found gaps)
    expect(w.metrics.completedTrips).toBeGreaterThan(0);
  });

  it('is deterministic for a given seed', () => {
    const a = build(7);
    const b = build(7);
    for (let n = 0; n < 300; n++) {
      tick(a);
      tick(b);
    }
    for (let i = 0; i < a.agents.capacity; i++) {
      expect(a.agents.s[i]).toBe(b.agents.s[i]);
      expect(a.agents.lane[i]).toBe(b.agents.lane[i]);
    }
  });
});
