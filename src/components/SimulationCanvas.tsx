'use client';

import 'react-tooltip/dist/react-tooltip.css';
import { Tooltip } from 'react-tooltip';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tick, setSignalPhase } from '@/engine';
import { createScene, setDemandRate, sampleStats, runExperiment, clearInterventions, captureConfig, scenarioSignature, applyControlSnapshot, toggleLaneClosed, toggleIncident, toggleSignal, flipPriority, setSourceRate, toggleDestination, DEFAULT_GRID, DEFAULT_CAPACITY, type Scene, type ExperimentResult, type Stats } from '@/render/scene';
import { framesToCars, frameStats } from '@/render/simFrame';
import { createSimClient, type SimClient } from './sim/simClient';
import { encodeScenario, decodeScenario, applyScenario, SCENARIO_PARAM } from '@/render/shareLink';
import { type Preset, type NetworkPreset } from '@/render/presets';
import { generateCandidates, type SweepRow, type Candidate } from '@/render/optimize';
import { runSweepPool } from './sim/sweepPool';
import { carRoute, isSelectedCarLive } from '@/render/carTrace';
import { drawScene, focusDimmer, type RenderCar, type RenderOverlay } from '@/render/renderer';
import { createCarRenderer, packCarInstances } from '@/render/glRenderer';
import {
  computeSelStats,
  compassLabels,
  scenarioChanged,
  unitsToRate,
  NONE_SEL,
  type Selection,
  type SelStats,
  type InspectorActions,
} from './sim/types';
import { type SimMutation } from './sim/simProtocol';
import { TopBar } from './sim/TopBar';
import { Telemetry } from './sim/Telemetry';
import { type SparkHandle } from './sim/Sparkline';
import { ControlDock } from './sim/ControlDock';
import { Presets } from './sim/Presets';
import { NetworkPresets } from './sim/NetworkPresets';
import { Coach } from './sim/Coach';
import { Inspector } from './sim/Inspector';
import { Experiment } from './sim/Experiment';
import { Optimizer } from './sim/Optimizer';
import { WorkflowStep } from './sim/ui';
import { hitTest } from './sim/hitTest';

const SIM_DT = 0.2;
const MAX_STEPS = 5;
const SAMPLE_DT = 1.0;
const DEFAULT_DEMAND = 4;

const fmtClock = (sec: number) => {
  const t = Math.max(0, Math.floor(sec));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
const EMPTY_ROUTE: number[] = [];
const SWEEP_TICKS = 300;

/** Map an optimizer candidate to its equivalent worker command. */
function mutationOfCandidate(c: Candidate): SimMutation | null {
  if (c.kind === 'signal') return { type: 'addSignals', junction: c.junction };
  if (c.kind === 'priority') return { type: 'flipPriority', junction: c.junction };
  if (c.kind === 'greenwave' && c.corridor !== undefined) return { type: 'greenWave', corridor: c.corridor };
  return null;
}

function buildInitialScene(
  scenarioParam: string | null | undefined,
  grid: number | null,
  cap: number | null,
): Scene {
  if (grid != null && grid >= 2) {
    return createScene(unitsToRate(DEFAULT_DEMAND), {
      grid: Math.floor(grid),
      capacity: cap != null && cap > 0 ? Math.floor(cap) : undefined,
    });
  }
  const scene = createScene(unitsToRate(DEFAULT_DEMAND));
  const parsed = scenarioParam ? decodeScenario(scenarioParam) : null;
  if (parsed) applyScenario(scene, parsed);
  return scene;
}

function demandUnitsOf(scene: Scene): number {
  return Math.round(Math.max(0, ...scene.sources.map((s) => s.rate)) * 10);
}

export function SimulationCanvas({
  scenarioParam = null,
  debug = false,
  grid = null,
  cap = null,
  worker = false,
}: {
  scenarioParam?: string | null;
  debug?: boolean;
  grid?: number | null;
  cap?: number | null;
  worker?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const sweepingRef = useRef(false);
  const simClientRef = useRef<SimClient | null>(null);
  const stagePendingRef = useRef(false);


  const [scene, setSceneState] = useState<Scene>(() => buildInitialScene(scenarioParam, grid, cap));
  const sceneRef = useRef<Scene>(scene);
  const cap0 = scene.world.agents.capacity;
  const prevSRef = useRef<Float32Array>(new Float32Array(cap0));
  const prevActiveRef = useRef<Uint8Array>(new Uint8Array(cap0));
  const prevLaneRef = useRef<Int32Array>(new Int32Array(cap0));
  const accRef = useRef(0);
  const lastTsRef = useRef(0);

  const playingRef = useRef(true);
  const speedRef = useRef(1);
  const selRef = useRef<Selection>(NONE_SEL);
  const hoverLaneRef = useRef(-1);
  const hoverJctRef = useRef(-1);
  const stagedRef = useRef({ junction: -1, at: 0 });
  const carsRef = useRef<RenderCar[]>([]);

  const hudCars = useRef<HTMLSpanElement>(null);
  const hudFlow = useRef<HTMLSpanElement>(null);
  const hudSpeed = useRef<HTMLSpanElement>(null);
  const hudTrips = useRef<HTMLSpanElement>(null);
  const hudClock = useRef<HTMLSpanElement>(null);
  const dispRef = useRef({ cars: 0, flow: 0, speed: 0 });
  const flowRef = useRef({ t: 0, trips: 0, val: 0 });

  const flowSparkRef = useRef<SparkHandle>(null);
  const speedSparkRef = useRef<SparkHandle>(null);
  const sampleRef = useRef({ t: 0, trips: 0 });
  const freeKmh = useMemo(
    () => scene.world.graph.speedLimit[0] * scene.world.vparams[0].v0Factor * 3.6,
    [scene],
  );

  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [demand, setDemand] = useState(() => demandUnitsOf(scene));
  const [sel, setSel] = useState<Selection>(NONE_SEL);
  const [selStats, setSelStats] = useState<SelStats | null>(null);
  const [, forceRender] = useState(0);
  const bump = useCallback(() => forceRender((n) => n + 1), []);
  const [expResult, setExpResult] = useState<ExperimentResult | null>(null);
  const [expRunning, setExpRunning] = useState(false);
  const [expDuration, setExpDuration] = useState(600);
  const [coachDismissed, setCoachDismissed] = useState(false);
  const [sweepRunning, setSweepRunning] = useState(false);
  const [sweepProg, setSweepProg] = useState({ done: 0, total: 0 });
  const [sweepResult, setSweepResult] = useState<{ baseline: Stats; rows: SweepRow[]; sig: string } | null>(null);
  const [shared, setShared] = useState(false);
  const [stagedNeedsRun, setStagedNeedsRun] = useState(false);

  const [network, setNetwork] = useState(() => ({
    grid: grid ?? DEFAULT_GRID,
    capacity: scene.world.agents.capacity,
  }));
  const demandSkip = useRef(true);

  const perfRef = useRef({ tick: 0, draw: 0, fps: 0, lastPaint: 0 });
  const perfBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    playingRef.current = playing;
    simClientRef.current?.setPlaying(playing);
  }, [playing]);
  useEffect(() => {
    speedRef.current = speed;
    simClientRef.current?.setSpeed(speed);
  }, [speed]);
  useEffect(() => void (selRef.current = sel), [sel]);
  useEffect(() => {
    if (demandSkip.current) {
      demandSkip.current = false;
      return;
    }
    const c = simClientRef.current;
    if (c) c.setDemand(unitsToRate(demand));
    else setDemandRate(sceneRef.current, unitsToRate(demand));
  }, [demand]);

  useEffect(() => {
    sceneRef.current = scene;
    const cap = scene.world.agents.capacity;
    prevSRef.current = new Float32Array(cap);
    prevActiveRef.current = new Uint8Array(cap);
    prevLaneRef.current = new Int32Array(cap);
    prevSRef.current.set(scene.world.agents.s);
    prevActiveRef.current.set(scene.world.agents.active);
    prevLaneRef.current.set(scene.world.agents.lane);
    accRef.current = 0;
    flowRef.current = { t: 0, trips: 0, val: 0 };
    dispRef.current = { cars: 0, flow: 0, speed: 0 };
    sampleRef.current = { t: 0, trips: 0 };
    flowSparkRef.current?.reset();
    speedSparkRef.current?.reset();
  }, [scene]);

  const select = useCallback((next: Selection) => {
    setSel(next);
    const c = simClientRef.current;
    if (c) {
      c.setSelection(next);
      setSelStats(null);
    } else {
      setSelStats(next.kind === 'none' ? null : computeSelStats(sceneRef.current, next));
    }
  }, []);

  useEffect(() => {
    if (sel.kind === 'none') return;
    const id = window.setInterval(() => {
      const c = simClientRef.current;
      const st = c
        ? (c.selection()?.stats ?? null)
        : computeSelStats(sceneRef.current, selRef.current);

      if (st === null && selRef.current.kind === 'car') {
        setSel(NONE_SEL);
        setSelStats(null);
      } else {
        setSelStats(st);
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [sel]);

  const clearShareUrl = useCallback(() => {
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  const reset = useCallback(() => {
    const fresh = createScene(unitsToRate(demand), { grid: network.grid, capacity: network.capacity });
    setSceneState(fresh);
    simClientRef.current?.reset({
      grid: network.grid,
      capacity: network.capacity,
      demand: unitsToRate(demand),
      speed: speedRef.current,
      playing: playingRef.current,
    });
    setSel(NONE_SEL);
    setSelStats(null);
    setExpResult(null);
    setSweepResult(null);
    setStagedNeedsRun(false);
    clearShareUrl();
  }, [demand, clearShareUrl, network]);

  const applyPreset = useCallback((preset: Preset) => {
    const staged = createScene(preset.demandRate, { grid: network.grid, capacity: network.capacity });
    preset.stage?.(staged);
    setSceneState(staged);
    simClientRef.current?.reset({
      grid: network.grid,
      capacity: network.capacity,
      demand: preset.demandRate,
      speed: speedRef.current,
      playing: playingRef.current,
      config: captureConfig(staged),
    });
    setDemand(Math.round(preset.demandRate * 10));
    setSel(NONE_SEL);
    setSelStats(null);
    setExpResult(null);
    setSweepResult(null);
    setStagedNeedsRun(false);
    clearShareUrl();
  }, [clearShareUrl, network]);

  const applyNetwork = useCallback((net: NetworkPreset) => {
    setNetwork({ grid: net.grid, capacity: net.capacity });
    const fresh = createScene(net.demandRate, { grid: net.grid, capacity: net.capacity });
    setSceneState(fresh);
    simClientRef.current?.reset({
      grid: net.grid,
      capacity: net.capacity,
      demand: net.demandRate,
      speed: speedRef.current,
      playing: playingRef.current,
    });
    setDemand(Math.round(net.demandRate * 10));
    setSel(NONE_SEL);
    setSelStats(null);
    setExpResult(null);
    setSweepResult(null);
    setStagedNeedsRun(false);
    clearShareUrl();
  }, [clearShareUrl]);

  const share = useCallback(() => {
    const url = `${window.location.origin}${window.location.pathname}?${SCENARIO_PARAM}=${encodeScenario(sceneRef.current)}`;
    window.history.replaceState(null, '', url);
    void navigator.clipboard?.writeText(url).catch(() => {});
    setShared(true);
    window.setTimeout(() => setShared(false), 1800);
  }, []);

  const runExp = useCallback(() => {
    setExpRunning(true);
    setStagedNeedsRun(false);
    window.setTimeout(() => {
      setExpResult(runExperiment(sceneRef.current, expDuration));
      setExpRunning(false);
    }, 30);
  }, [expDuration]);

  const clearStaged = useCallback(() => {
    const c = simClientRef.current;
    if (c) c.mutate({ type: 'clearInterventions' });
    else {
      clearInterventions(sceneRef.current);
      bump();
    }
    setExpResult(null);
    setStagedNeedsRun(false);
  }, [bump]);

  const runSweep = useCallback(() => {
    if (sweepingRef.current) return;
    sweepingRef.current = true;
    const scene = sceneRef.current;
    const candidates = generateCandidates(scene);
    const cfg = captureConfig(scene);
    const sig = scenarioSignature(scene);
    setSweepRunning(true);
    setSweepResult(null);
    setSweepProg({ done: 0, total: candidates.length + 1 });
    runSweepPool(cfg, candidates, SWEEP_TICKS, (done, total) => setSweepProg({ done, total })).then(
      ({ baseStats, rows }) => {
        setSweepResult({ baseline: baseStats, rows, sig });
        setSweepRunning(false);
        sweepingRef.current = false;
      },
    );
  }, []);

  const stageCandidate = useCallback(
    (c: Candidate) => {
      const client = simClientRef.current;
      if (client) {
        const m = mutationOfCandidate(c);
        if (m) {
          stagePendingRef.current = true;
          client.mutate(m);
        }
      } else {
        c.apply(sceneRef.current);
        setSweepResult((r) => (r ? { ...r, sig: scenarioSignature(sceneRef.current) } : r));
        bump();
      }
      stagedRef.current = { junction: c.junction, at: performance.now() };
      select({ kind: 'junction', j: c.junction });
      setStagedNeedsRun(true);
    },
    [select, bump],
  );

  const pulseJunction = useCallback((j: number) => {
    stagedRef.current = { junction: j, at: performance.now() };
  }, []);

  const actions: InspectorActions = useMemo(
    () => ({
      toggleClose: (lane, closed) => {
        const c = simClientRef.current;
        if (c) c.mutate(closed ? { type: 'reopenRoad', lane } : { type: 'closeRoad', lane });
        else {
          toggleLaneClosed(sceneRef.current, lane);
          bump();
        }
      },
      toggleIncident: (lane, s, has) => {
        const c = simClientRef.current;
        if (c) c.mutate(has ? { type: 'removeIncident', lane } : { type: 'addIncident', lane, s });
        else {
          toggleIncident(sceneRef.current, lane, s);
          bump();
        }
      },
      toggleSignal: (j, on) => {
        const c = simClientRef.current;
        if (c) c.mutate(on ? { type: 'removeSignals', junction: j } : { type: 'addSignals', junction: j });
        else {
          toggleSignal(sceneRef.current, j);
          bump();
        }
      },
      flipPriority: (j) => {
        const c = simClientRef.current;
        if (c) c.mutate({ type: 'flipPriority', junction: j });
        else {
          flipPriority(sceneRef.current, j);
          bump();
        }
      },
      setSourceRate: (lane, rate) => {
        const c = simClientRef.current;
        if (c) c.setSourceRate(lane, rate);
        else {
          const ctl = sceneRef.current.sources.find((s) => s.lane === lane);
          if (ctl) {
            setSourceRate(sceneRef.current, ctl, rate);
            bump();
          }
        }
      },
      toggleDestination: (lane, sink) => {
        const c = simClientRef.current;
        if (c) c.mutate({ type: 'toggleDestination', lane, sink });
        else {
          const ctl = sceneRef.current.sources.find((s) => s.lane === lane);
          if (ctl) {
            toggleDestination(sceneRef.current, ctl, sink);
            bump();
          }
        }
      },
    }),
    [bump],
  );

  const isCandidateStaged = useCallback((c: Candidate) => {
    const scene = sceneRef.current;
    if (c.kind === 'greenwave') return c.corridor !== undefined && scene.coordinated[c.corridor] > 0;
    if (c.kind === 'signal') return scene.signals[c.junction]?.enabled === true;
    const { rank } = scene.world.control;
    const conns = scene.world.graph.connections;
    return scene.junctions[c.junction].approaches.some((ap) =>
      ap.conns.some((ci) => rank[ci] !== conns[ci].rank),
    );
  }, []);

  const fastForward = useCallback(() => {
    const c = simClientRef.current;
    if (c) {
      c.fastForward(300);
      return;
    }
    const world = sceneRef.current.world;
    for (let i = 0; i < 300; i++) tick(world);
    prevSRef.current.set(world.agents.s);
    prevActiveRef.current.set(world.agents.active);
    prevLaneRef.current.set(world.agents.lane);
    accRef.current = 0;
    lastTsRef.current = 0;
    flowRef.current = { t: world.time, trips: world.metrics.completedTrips, val: 0 };
    sampleRef.current = { t: world.time, trips: world.metrics.completedTrips };
  }, []);

  const hitTestAt = useCallback((clientX: number, clientY: number): Selection => {
    const canvas = canvasRef.current;
    if (!canvas) return NONE_SEL;
    const rect = canvas.getBoundingClientRect();
    return hitTest(sceneRef.current, carsRef.current, rect, clientX - rect.left, clientY - rect.top);
  }, []);

  const onCanvasClick = useCallback(
    (e: React.MouseEvent) => select(hitTestAt(e.clientX, e.clientY)),
    [hitTestAt, select],
  );
  const onCanvasMove = useCallback(
    (e: React.MouseEvent) => {
      const hit = hitTestAt(e.clientX, e.clientY);
      hoverLaneRef.current = hit.kind === 'lane' ? hit.lane : -1;
      hoverJctRef.current = hit.kind === 'junction' ? hit.j : -1;
      const el = canvasRef.current;
      if (el) el.style.cursor = hit.kind === 'none' ? 'default' : 'pointer';
    },
    [hitTestAt],
  );
  const onCanvasLeave = useCallback(() => {
    hoverLaneRef.current = -1;
    hoverJctRef.current = -1;
  }, []);

  useEffect(() => {
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
        grid: grid ?? DEFAULT_GRID,
        capacity: cap ?? DEFAULT_CAPACITY,
        demand: unitsToRate(DEFAULT_DEMAND),
        speed: speedRef.current,
        playing: playingRef.current,
        config: captureConfig(sceneRef.current),
      });
      client?.onControl((config) => {
        applyControlSnapshot(sceneRef.current, config);
        if (stagePendingRef.current) {
          stagePendingRef.current = false;
          setSweepResult((r) => (r ? { ...r, sig: scenarioSignature(sceneRef.current) } : r));
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
      const client = simClientRef.current;
      if (client) {
        const fr = client.frames();
        if (fr.cur) {
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
          const route = client.selection()?.route;
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
  }, [worker, grid, cap, bump]);

  const sinkLabels = useMemo(() => compassLabels(scene.sinks.map((l) => scene.geometry.b[l])), [scene]);
  const sinkLabelOf = useCallback(
    (sink: number) => {
      const i = scene.sinks.indexOf(sink);
      return i >= 0 ? sinkLabels[i] : `#${sink}`;
    },
    [scene, sinkLabels],
  );

  const changed = scenarioChanged(scene);
  const sweepStale = !!sweepResult && scenarioSignature(scene) !== sweepResult.sig;
  const coachStep = !changed ? 0 : !expResult ? 1 : 2;

  return (
    <div className="flex min-h-dvh flex-col bg-(--bg) text-(--text-1) lg:h-dvh">
      <TopBar
        playing={playing}
        hudCars={hudCars}
        hudFlow={hudFlow}
        hudSpeed={hudSpeed}
        hudTrips={hudTrips}
      />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative h-[56dvh] min-h-0 shrink-0 lg:h-auto lg:flex-1">
          <canvas
            ref={canvasRef}
            onClick={onCanvasClick}
            onMouseMove={onCanvasMove}
            onMouseLeave={onCanvasLeave}
            className="absolute inset-0 h-full w-full cursor-pointer"
          />
          <canvas ref={glCanvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />

          <ControlDock
            playing={playing}
            onTogglePlay={() => setPlaying((p) => !p)}
            speed={speed}
            onSpeed={setSpeed}
            demand={demand}
            onDemand={setDemand}
            onReset={reset}
            onFastForward={fastForward}
            onShare={share}
            shared={shared}
            clockRef={hudClock}
          />

          {!coachDismissed && coachStep < 2 && <Coach step={coachStep} onDismiss={() => setCoachDismissed(true)} />}

          {debug && (
            <div
              ref={perfBoxRef}
              className="pointer-events-none absolute left-3 top-3 z-30 rounded-md border border-(--border) bg-black/70 px-2.5 py-1 font-mono text-[11px] tabular-nums text-(--text-2)"
            />
          )}
        </div>

        <aside className="thin-scroll flex w-full shrink-0 flex-col gap-3 border-t border-(--border) p-3 lg:min-h-0 lg:w-92 lg:overflow-y-auto lg:border-l lg:border-t-0">
          <NetworkPresets activeGrid={network.grid} onApply={applyNetwork} />
          <Inspector scene={scene} sel={sel} stats={selStats} actions={actions} onClear={() => select(NONE_SEL)} sinkLabelOf={sinkLabelOf} pulseJunction={pulseJunction} />
          <Telemetry flowSpark={flowSparkRef} speedSpark={speedSparkRef} freeKmh={freeKmh} />

          {/* The experimentation workflow, threaded as ordered steps. */}
          <div className="flex flex-col">
            <WorkflowStep n={1} first>
              <Presets onApply={applyPreset} />
            </WorkflowStep>
            <WorkflowStep n={2}>
              <Experiment
                result={expResult}
                running={expRunning}
                duration={expDuration}
                onDuration={setExpDuration}
                onRun={runExp}
                onClearStaged={clearStaged}
                hasIntervention={changed}
                highlight={stagedNeedsRun || (!coachDismissed && coachStep === 1)}
              />
            </WorkflowStep>
            <WorkflowStep n={3} last>
              <Optimizer
                running={sweepRunning}
                done={sweepProg.done}
                total={sweepProg.total}
                result={sweepResult}
                onRun={runSweep}
                onStage={stageCandidate}
                isStaged={isCandidateStaged}
                stale={sweepStale}
              />
            </WorkflowStep>
          </div>
        </aside>
      </div>

      <Tooltip id="uf-tip" className="uf-tooltip" classNameArrow="uf-tooltip-arrow" place="top" />
    </div>
  );
}
