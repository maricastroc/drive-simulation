import { describe, it, expect } from 'vitest';
import {
  buildLaneGraph,
  createWorld,
  tick,
  allocAgent,
  pushBack,
  computeRoute,
  addRoute,
  NONE,
  type World,
} from '../index';

// A diamond: 0 forks to 1 and 2, both rejoin at 3. Lane 2 is a long detour.
// Shortest 0 -> 3 must go through lane 1. Lane 4 is isolated (unreachable).
function diamond() {
  return buildLaneGraph(
    [
      { length: 10, speedLimit: 16, fromNode: 0, toNode: 1 }, // 0
      { length: 10, speedLimit: 16, fromNode: 1, toNode: 2 }, // 1 (short)
      { length: 100, speedLimit: 16, fromNode: 1, toNode: 3 }, // 2 (long detour)
      { length: 10, speedLimit: 16, fromNode: 2, toNode: 4 }, // 3
      { length: 10, speedLimit: 16, fromNode: 8, toNode: 9 }, // 4 (isolated)
    ],
    [
      { fromLane: 0, toLane: 1 },
      { fromLane: 0, toLane: 2 },
      { fromLane: 1, toLane: 3 },
      { fromLane: 2, toLane: 3 },
    ],
  );
}

// A fork: lane 0 (IN) splits into lane 1 (straight) and lane 2 (turn), both sinks.
function fork() {
  return buildLaneGraph(
    [
      { length: 100, speedLimit: 16, fromNode: 0, toNode: 1 }, // 0 IN
      { length: 100, speedLimit: 16, fromNode: 1, toNode: 2 }, // 1 straight (sink)
      { length: 100, speedLimit: 16, fromNode: 1, toNode: 3 }, // 2 turn (sink)
    ],
    [
      { fromLane: 0, toLane: 1 },
      { fromLane: 0, toLane: 2 },
    ],
  );
}

describe('routing: computeRoute (Dijkstra)', () => {
  it('finds the shortest path through the cheap branch', () => {
    const g = diamond();
    expect(computeRoute(g, 0, 3)).toEqual([0, 1, 3]); // via lane 1, not the long lane 2
  });

  it('returns the trivial path to itself', () => {
    expect(computeRoute(diamond(), 0, 0)).toEqual([0]);
  });

  it('returns null when the destination is unreachable', () => {
    expect(computeRoute(diamond(), 0, 4)).toBeNull();
  });
});

describe('routing: cars follow their route through a fork', () => {
  const build = (seed: number): World => {
    const w = createWorld(fork(), 64, undefined, seed);
    const straight = addRoute(w, computeRoute(w.graph, 0, 1)!); // [0, 1]
    const turn = addRoute(w, computeRoute(w.graph, 0, 2)!); // [0, 2]
    w.demand.push({ lane: 0, rate: 1.5, routes: [straight, turn] });
    return w;
  };

  it('sends cars down both exits and completes trips', () => {
    const w = build(42);
    let sawStraight = false;
    let sawTurn = false;
    for (let n = 0; n < 600; n++) {
      tick(w);
      if (w.occ.head[1] !== NONE) sawStraight = true;
      if (w.occ.head[2] !== NONE) sawTurn = true;
    }
    expect(sawStraight).toBe(true); // some cars took 0 -> 1
    expect(sawTurn).toBe(true); // some cars took 0 -> 2
    expect(w.metrics.completedTrips).toBeGreaterThan(0);
  });

  it('never throws while routed cars pick their exit', () => {
    const w = build(7);
    expect(() => {
      for (let n = 0; n < 400; n++) tick(w);
    }).not.toThrow();
  });

  it('throws for a routeless car on a multi-exit lane (a route is required)', () => {
    const w = createWorld(fork(), 8);
    const id = allocAgent(w.agents);
    w.agents.s[id] = 100; // sitting at the end of the two-exit lane 0
    w.agents.v[id] = 5;
    pushBack(w.agents, w.occ, 0, id);
    expect(() => tick(w)).toThrow();
  });

  it('is deterministic for a given seed', () => {
    const a = build(11);
    const b = build(11);
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
