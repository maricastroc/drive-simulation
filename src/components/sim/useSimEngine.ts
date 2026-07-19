import { useCallback, useMemo } from 'react';
import type { Scene } from '@/render/scene';
import { applyCommand, type SimMutation } from './simProtocol';
import type { SimClient } from './simClient';
import type { InspectorActions } from './types';

/**
 * The action layer, collapsed. Every intervention is one `SimMutation`; the engine
 * routes it to the authoritative sim — the worker (`client.mutate`) when off-thread,
 * or the local mirror via `applyCommand` (the same validated helper the worker runs)
 * otherwise. This removes the ~6 hand-branched `if (client) … else …` callbacks the
 * component used to carry, and keeps a single source of truth for how a change lands.
 *
 * `setSourceRate` stays a distinct primitive because the worker path is throttled
 * (`client.setSourceRate`), unlike the one-shot `mutate` commands.
 */
export function useSimEngine(
  simClientRef: React.RefObject<SimClient | null>,
  sceneRef: React.RefObject<Scene>,
  bump: () => void,
) {
  const mutate = useCallback(
    (m: SimMutation) => {
      const c = simClientRef.current;
      if (c) c.mutate(m);
      else {
        applyCommand(sceneRef.current, m);
        bump();
      }
    },
    [simClientRef, sceneRef, bump],
  );

  const setSourceRate = useCallback(
    (lane: number, rate: number) => {
      const c = simClientRef.current;
      if (c) c.setSourceRate(lane, rate);
      else {
        applyCommand(sceneRef.current, { type: 'setSourceRate', lane, rate });
        bump();
      }
    },
    [simClientRef, sceneRef, bump],
  );

  const actions: InspectorActions = useMemo(
    () => ({
      toggleClose: (lane, closed) => mutate(closed ? { type: 'reopenRoad', lane } : { type: 'closeRoad', lane }),
      toggleIncident: (lane, s, has) => mutate(has ? { type: 'removeIncident', lane } : { type: 'addIncident', lane, s }),
      toggleSignal: (j, on) => mutate(on ? { type: 'removeSignals', junction: j } : { type: 'addSignals', junction: j }),
      flipPriority: (j) => mutate({ type: 'flipPriority', junction: j }),
      setSourceRate,
      toggleDestination: (lane, sink) => mutate({ type: 'toggleDestination', lane, sink }),
    }),
    [mutate, setSourceRate],
  );

  return { mutate, actions };
}
