import { useEffect } from 'react';
import { tick, setSignalPhase } from '@/engine';
import {
  sampleStats,
  captureConfig,
  applyControlSnapshot,
  type Scene,
  type Stats,
} from '@/render/scene';
import { framesToCars, frameStats } from '@/render/simFrame';
import { createSimClient, type SimClient } from './simClient';
import { carRoute, isSelectedCarLive } from '@/render/carTrace';
import { drawScene, focusDimmer, type RenderCar, type RenderOverlay } from '@/render/renderer';
import { createCarRenderer, packCarInstances } from '@/render/glRenderer';
import type { Selection } from './types';
import type { SparkHandle } from './Sparkline';

const SIM_DT = 0.2;
const MAX_STEPS = 5;
const SAMPLE_DT = 1.0;
const EMPTY_ROUTE: number[] = [];

const fmtClock = (sec: number) => {
  const t = Math.max(0, Math.floor(sec));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/** The mutable handles the render loop reads every frame. They're created (and
 *  otherwise consumed) by the owning component; the loop only reads/writes their
 *  `.current`. Bundle them once (`useMemo`) so this stays a stable effect input. */
export interface SimLoopRefs {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  glCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  sceneRef: React.RefObject<Scene>;
  prevSRef: React.RefObject<Float32Array>;
  prevActiveRef: React.RefObject<Uint8Array>;
  prevLaneRef: React.RefObject<Int32Array>;
  accRef: React.RefObject<number>;
  lastTsRef: React.RefObject<number>;
  playingRef: React.RefObject<boolean>;
  speedRef: React.RefObject<number>;
  selRef: React.RefObject<Selection>;
  hoverLaneRef: React.RefObject<number>;
  hoverJctRef: React.RefObject<number>;
  stagedRef: React.RefObject<{ junction: number; at: number }>;
  carsRef: React.RefObject<RenderCar[]>;
  simClientRef: React.RefObject<SimClient | null>;
  stagePendingRef: React.RefObject<boolean>;
  hudCars: React.RefObject<HTMLSpanElement | null>;
  hudFlow: React.RefObject<HTMLSpanElement | null>;
  hudSpeed: React.RefObject<HTMLSpanElement | null>;
  hudTrips: React.RefObject<HTMLSpanElement | null>;
  hudClock: React.RefObject<HTMLSpanElement | null>;
  dispRef: React.RefObject<{ cars: number; flow: number; speed: number }>;
  flowRef: React.RefObject<{ t: number; trips: number; val: number }>;
  sampleRef: React.RefObject<{ t: number; trips: number }>;
  flowSparkRef: React.RefObject<SparkHandle | null>;
  speedSparkRef: React.RefObject<SparkHandle | null>;
  perfRef: React.RefObject<{ tick: number; draw: number; fps: number; lastPaint: number }>;
  perfBoxRef: React.RefObject<HTMLDivElement | null>;
}

export interface SimLoopArgs {
  worker: boolean;
  grid: number | null;
  cap: number | null;
  /** Demand the worker world boots at (units already converted to cars/s). */
  initialDemand: number;
  refs: SimLoopRefs;
  bump: () => void;
  /** Fired once when the worker confirms an optimizer-staged mutation (see
   *  `stagePendingRef`), so the sweep leaderboard's staleness signature can refold. */
  onStageConfirmed: () => void;
}

/**
 * Owns the `requestAnimationFrame` render loop and the worker-client lifecycle.
 * The loop is authoritative-worker-aware: it interpolates packed worker frames
 * when a `SimClient` is present, and falls back to ticking the local world on the
 * main thread otherwise. Pure read of simulation state → determinism is untouched.
 * Extracted from `SimulationCanvas` so that component stays composition, not loop.
 */
export function useSimLoop({ worker, grid, cap, initialDemand, refs, bump, onStageConfirmed }: SimLoopArgs) {
  useEffect(() => {
    const {
      canvasRef, glCanvasRef, sceneRef, prevSRef, prevActiveRef, prevLaneRef, accRef, lastTsRef,
      playingRef, speedRef, selRef, hoverLaneRef, hoverJctRef, stagedRef, carsRef, simClientRef,
      stagePendingRef, hudCars, hudFlow, hudSpeed, hudTrips, hudClock, dispRef, flowRef, sampleRef,
      flowSparkRef, speedSparkRef, perfRef, perfBoxRef,
    } = refs;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const glCanvas = glCanvasRef.current;
    const gl = glCanvas?.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: false }) ?? null;
    const carGL = gl ? createCarRenderer(gl) : null;
    let packBuf: Float32Array | undefined;

    if (worker) {
      const client = createSimClient({
        grid: sceneRef.current.grid,
        capacity: sceneRef.current.world.agents.capacity,
        demand: initialDemand,
        speed: speedRef.current,
        playing: playingRef.current,
        config: captureConfig(sceneRef.current),
      });
      client?.onControl((config) => {
        applyControlSnapshot(sceneRef.current, config);
        if (stagePendingRef.current) {
          stagePendingRef.current = false;
          onStageConfirmed();
        }
        bump();
      });
      simClientRef.current = client;
    }

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (glCanvas) {
        glCanvas.width = Math.round(glCanvas.clientWidth * dpr);
        glCanvas.height = Math.round(glCanvas.clientHeight * dpr);
      }
    };
    resize();
    window.addEventListener('resize', resize);

    let raf = 0;
    const loop = (ts: number) => {
      const scene = sceneRef.current;
      const { world } = scene;
      const { agents } = world;
      const prevS = prevSRef.current;
      const prevActive = prevActiveRef.current;
      const prevLane = prevLaneRef.current;

      const last = lastTsRef.current || ts;
      const frameMs = ts - last;
      let dtReal = (ts - last) / 1000;
      lastTsRef.current = ts;
      if (dtReal > 0.1) dtReal = 0.1;

      if (playingRef.current) accRef.current += dtReal * speedRef.current;

      let steps = 0;
      let tickMs = 0;
      let cars: RenderCar[];
      let st: Stats;
      let clientGridOk = false;
      const client = simClientRef.current;
      if (client) {
        const fr = client.frames();

        if (fr.cur && fr.grid === scene.grid) {
          clientGridOk = true;
          const expected = (SIM_DT * 1000) / Math.max(fr.speed, 0.001);
          const alpha = Math.min((ts - fr.arrival) / expected, 1);
          cars = framesToCars(fr.prev, fr.cur, alpha, world.vparams, world.graph.speedLimit);
          const fs = frameStats(fr.cur);
          st = { cars: fs.cars, avgSpeedKmh: fs.avgSpeedKmh, completedTrips: fs.completedTrips, avgTravelTime: 0, time: fs.time };
          const ph = fr.sigPhase;
          for (let j = 0; j < scene.signals.length; j++) {
            const sc = scene.signals[j];
            if (sc && ph[j] >= 0) setSignalPhase(world.control, sc, ph[j]);
          }
        } else {
          cars = [];
          st = { cars: 0, avgSpeedKmh: 0, completedTrips: 0, avgTravelTime: 0, time: 0 };
        }
      } else {
        const tickT0 = performance.now();
        while (accRef.current >= SIM_DT && steps < MAX_STEPS) {
          prevS.set(agents.s);
          prevActive.set(agents.active);
          prevLane.set(agents.lane);
          tick(world);
          accRef.current -= SIM_DT;
          steps += 1;
        }
        tickMs = performance.now() - tickT0;
        const alpha = Math.min(accRef.current / SIM_DT, 1);
        const v0 = world.graph.speedLimit[0] * world.vparams[0].v0Factor;
        cars = [];
        for (let id = 0; id < agents.capacity; id++) {
          if (!agents.active[id]) continue;
          const lane = agents.lane[id];
          const curS = agents.s[id];
          const interp = prevActive[id] === 1 && prevLane[id] === lane;
          const s = interp ? prevS[id] + (curS - prevS[id]) * alpha : curS;
          cars.push({ id, key: agents.enterTime[id], lane, s, length: world.vparams[agents.type[id]].length, speedFrac: agents.v[id] / v0 });
        }
        st = sampleStats(world);
      }
      carsRef.current = cars;

      const cur = selRef.current;
      let selCar = -1;
      let carRouteLanes: readonly number[] = EMPTY_ROUTE;
      let carRouteI = -1;
      if (cur.kind === 'car') {
        if (client) {
          const route = clientGridOk ? client.selection()?.route : null;
          if (route) {
            selCar = cur.id;
            carRouteLanes = route.lanes;
            carRouteI = route.idx;
          }
        } else if (isSelectedCarLive(world, cur.id, cur.key)) {
          selCar = cur.id;
          const r = carRoute(world, cur.id);
          if (r) {
            carRouteLanes = r.lanes;
            carRouteI = r.idx;
          }
        }
      }
      const overlay: RenderOverlay = {
        selectedLane: cur.kind === 'lane' ? cur.lane : -1,
        hoverLane: hoverLaneRef.current,
        selectedJunction: cur.kind === 'junction' ? cur.j : -1,
        hoverJunction: hoverJctRef.current,
        selectedCar: selCar,
        carRoute: carRouteLanes,
        carRouteIdx: carRouteI,
        now: ts,
        stagedJunction: stagedRef.current.junction,
        stagedAt: stagedRef.current.at,
      };
      const drawT0 = performance.now();
      drawScene(ctx, canvas.clientWidth, canvas.clientHeight, scene, cars, overlay, { drawCars: !carGL });
      if (carGL) {
        const packed = packCarInstances(scene.geometry, canvas.clientWidth, canvas.clientHeight, cars, focusDimmer(scene, overlay), packBuf);
        packBuf = packed.data;
        carGL.draw(canvas.clientWidth, canvas.clientHeight, packed.data, packed.count);
      }
      const drawMs = performance.now() - drawT0;

      const jump = st.time - flowRef.current.t;
      if (jump < 0 || jump > 5) {
        flowRef.current = { t: st.time, trips: st.completedTrips, val: 0 };
        sampleRef.current = { t: st.time, trips: st.completedTrips };
      }

      const f = flowRef.current;
      if (st.time - f.t >= 1.5) {
        f.val = ((st.completedTrips - f.trips) / (st.time - f.t)) * 60;
        f.t = st.time;
        f.trips = st.completedTrips;
      }
      const d = dispRef.current;
      d.cars += (st.cars - d.cars) * 0.14;
      d.flow += (f.val - d.flow) * 0.1;
      d.speed += (st.avgSpeedKmh - d.speed) * 0.12;
      if (hudCars.current) hudCars.current.textContent = String(Math.round(d.cars));
      if (hudFlow.current) hudFlow.current.textContent = d.flow.toFixed(1);
      if (hudSpeed.current) hudSpeed.current.textContent = String(Math.round(d.speed));
      if (hudTrips.current) hudTrips.current.textContent = String(st.completedTrips);
      if (hudClock.current) hudClock.current.textContent = fmtClock(st.time);

      const smp = sampleRef.current;
      const dtS = st.time - smp.t;
      if (dtS >= SAMPLE_DT) {
        flowSparkRef.current?.push(((st.completedTrips - smp.trips) / dtS) * 60);
        speedSparkRef.current?.push(st.avgSpeedKmh);
        smp.t = st.time;
        smp.trips = st.completedTrips;
      }

      const box = perfBoxRef.current;
      if (box) {
        const pf = perfRef.current;
        if (steps > 0) pf.tick += (tickMs / steps - pf.tick) * 0.2;
        pf.draw += (drawMs - pf.draw) * 0.1;
        if (frameMs > 0) pf.fps += (1000 / frameMs - pf.fps) * 0.1;
        if (ts - pf.lastPaint > 250) {
          pf.lastPaint = ts;
          box.textContent = `${cars.length} cars · ${pf.fps.toFixed(0)} fps · tick ${pf.tick.toFixed(1)}ms · draw ${pf.draw.toFixed(1)}ms`;
        }
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      carGL?.dispose();
      simClientRef.current?.dispose();
      simClientRef.current = null;
    };
  }, [worker, grid, cap, initialDemand, refs, bump, onStageConfirmed]);
}
