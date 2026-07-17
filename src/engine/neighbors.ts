import type { World } from './world';
import { NONE } from './types';
import { STOP_OFFSET } from './constants';
import { nextConnection, mustYield } from './intersection';

/** What an agent is following: net gap to the obstacle (m) and its speed (m/s). */
export interface Leader {
  readonly gap: number; // bumper-to-bumper distance (m); Infinity on open road
  readonly leadV: number; // obstacle speed (m/s); 0 on open road / at a stop line
}

// Shared instance for the common "no obstacle" case, so a lone car allocates nothing.
const OPEN_ROAD: Leader = { gap: Infinity, leadV: 0 };

/**
 * Find the obstacle an agent must react to (design doc §H).
 *
 *   (1)  a leader in the same lane, else the agent is the front car and we look beyond:
 *   (2a) a virtual stopped leader at the stop line, if it must yield at the junction;
 *   (2b) the last car of the downstream lane it is about to enter; else
 *   (2c) open road (including a sink lane, whose end is handled by despawn).
 */
export function findLeader(world: World, i: number): Leader {
  const { agents, occ, graph, vparams } = world;
  const lane = agents.lane[i];

  const j = agents.ahead[i];
  if (j !== NONE) {
    const gap = agents.s[j] - agents.s[i] - vparams[agents.type[j]].length;
    return { gap, leadV: agents.v[j] };
  }

  const c = nextConnection(world, lane);
  if (c === NONE) return OPEN_ROAD; // sink lane

  if (mustYield(world, c)) {
    const gap = Math.max(graph.length[lane] - agents.s[i] - STOP_OFFSET, 0);
    return { gap, leadV: 0 };
  }

  const conn = graph.connections[c];
  const tail = occ.tail[conn.toLane];
  if (tail !== NONE) {
    const gap =
      graph.length[lane] -
      agents.s[i] +
      conn.length +
      agents.s[tail] -
      vparams[agents.type[tail]].length;
    return { gap, leadV: agents.v[tail] };
  }
  return OPEN_ROAD;
}
