import type { World } from './world';
import { NONE } from './types';
import { SPAWN_CLEARANCE } from './constants';
import { nextRandom } from './rng';
import { allocAgent } from './agents';
import { pushBack } from './laneList';

export function spawn(world: World): void {
  const { agents, occ, dt } = world;

  for (const src of world.demand) {
    const r = nextRandom(world.rngState);
    world.rngState = r.state;
    if (r.value >= src.rate * dt) continue;

    if (world.control.laneClosed[src.lane] === 1) continue;
    if (src.routes && src.routes.length === 0) continue;

    const tail = occ.tail[src.lane];
    if (tail !== NONE && agents.s[tail] < SPAWN_CLEARANCE) continue;

    const id = allocAgent(agents);
    if (id === NONE) continue;

    agents.s[id] = 0;
    agents.v[id] = src.speed ?? 0;
    agents.type[id] = 0;
    agents.enterTime[id] = world.time;

    if (src.routes && src.routes.length > 0) {
      const pick = nextRandom(world.rngState);
      world.rngState = pick.state;
      const route = src.routes[Math.min(src.routes.length - 1, Math.floor(pick.value * src.routes.length))];
      agents.routeStart[id] = route.start;
      agents.routeEnd[id] = route.end;
      agents.routeIdx[id] = route.start;
    }

    pushBack(agents, occ, src.lane, id);
  }
}
