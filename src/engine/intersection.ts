import type { World } from './world';
import { NONE } from './types';
import { T_SAFE, V_EPS } from './constants';

/**
 * The outgoing connection index the car currently on `lane` will take, or NONE if `lane` is a
 * sink (a completed trip). First intersection: at most one outgoing connection per lane —
 * choosing among several exits needs a route (A*), which is a later Etapa.
 */
export function nextConnection(world: World, lane: number): number {
  const { graph } = world;
  const start = graph.connStart[lane];
  const end = graph.connEnd[lane];
  if (end <= start) return NONE;
  if (end - start > 1) {
    throw new Error('multiple outgoing connections need routing (not implemented yet)');
  }
  return start;
}

/**
 * Strict-priority gap acceptance (design doc §J): must a car taking connection `c` yield?
 *
 * It yields iff some strictly-higher-rank conflicting movement has an approaching car that will
 * reach the junction within T_SAFE seconds. Ranks are unique per node, so the top-priority
 * movement never yields — there is always someone who may go, hence no deadlock.
 */
export function mustYield(world: World, c: number): boolean {
  const { graph, agents, occ } = world;
  const conn = graph.connections[c];

  for (const c2 of conn.conflicts) {
    const other = graph.connections[c2];
    if (other.rank <= conn.rank) continue; // only yield to strictly higher priority

    const k = occ.head[other.fromLane]; // nearest car to the junction on the conflicting approach
    if (k === NONE) continue;

    const dist = graph.length[other.fromLane] - agents.s[k];
    const tta = dist / Math.max(agents.v[k], V_EPS);
    if (tta < T_SAFE) return true;
  }
  return false;
}
