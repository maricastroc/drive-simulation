import type { World } from './world';
import { NONE } from './types';
import { popFront, pushBack } from './laneList';
import { freeAgent } from './agents';
import { nextConnection } from './intersection';

/**
 * FASE 3 — advance vehicles across the network and remove finished trips (design doc §G).
 *
 * A car that reaches the end of its lane either crosses the junction onto its single outgoing
 * connection (carrying any overflow past the — zero-length — junction point) or, on a sink lane,
 * completes its trip and is despawned with its travel time recorded.
 */
export function advance(world: World): void {
  const { agents, occ, graph, metrics } = world;

  for (let lane = 0; lane < graph.laneCount; lane++) {
    let head = occ.head[lane];
    while (head !== NONE && agents.s[head] >= graph.length[lane]) {
      const c = nextConnection(world, lane);
      const overflow = agents.s[head] - graph.length[lane];
      const id = popFront(agents, occ, lane);

      if (c === NONE) {
        metrics.completedTrips += 1;
        metrics.totalTravelTime += world.time - agents.enterTime[id];
        freeAgent(agents, id);
      } else {
        const conn = graph.connections[c];
        agents.s[id] = Math.max(overflow - conn.length, 0);
        pushBack(agents, occ, conn.toLane, id);
      }
      head = occ.head[lane];
    }
  }
}
