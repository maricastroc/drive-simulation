import { describe, it, expect } from 'vitest';
import { createScene } from '@/render/scene';
import { fitCamera, project, placementAt } from '@/render/geometry';
import { hitTest, JUNCTION_BIAS_PX, type HitCar } from '../hitTest';

const VIEW = { width: 900, height: 700 };

function setup() {
  const scene = createScene(0);
  const geom = scene.geometry;
  const cam = fitCamera(geom, VIEW.width, VIEW.height);
  // A junction with at least one real incoming lane (an interior cross).
  const jIdx = scene.junctions.findIndex((j) => j.approaches.some((a) => a.fromLane >= 0));
  const junction = scene.junctions[jIdx];
  const fromLane = junction.approaches.find((a) => a.fromLane >= 0)!.fromLane;
  const jSp = project(cam, junction.pos.x, junction.pos.y);
  const laneLen = (l: number) => Math.hypot(geom.b[l].x - geom.a[l].x, geom.b[l].y - geom.a[l].y);
  const carScreen = (l: number, s: number) => {
    const p = placementAt(geom, l, s);
    return project(cam, p.x, p.y);
  };
  return { scene, geom, cam, jIdx, junction, fromLane, jSp, laneLen, carScreen };
}

describe('hitTest — click → map selection', () => {
  it('selects a junction when you click its node (no cars)', () => {
    const { scene, jIdx, jSp } = setup();
    const sel = hitTest(scene, [], VIEW, jSp.x, jSp.y);
    expect(sel).toEqual({ kind: 'junction', j: jIdx });
  });

  it('keeps a junction clickable even with a car sitting on it (the dense-traffic fix)', () => {
    const { scene, jIdx, fromLane, jSp, laneLen, carScreen } = setup();
    // A car at the very end of an approach lane sits on the junction node.
    const car: HitCar = { id: 7, key: 1, lane: fromLane, s: laneLen(fromLane) };
    const carSp = carScreen(fromLane, car.s);
    // Precondition: the car really is on top of the junction (within the car radius).
    expect(Math.hypot(carSp.x - jSp.x, carSp.y - jSp.y)).toBeLessThan(11);

    const sel = hitTest(scene, [car], VIEW, jSp.x, jSp.y);
    expect(sel).toEqual({ kind: 'junction', j: jIdx });
  });

  it('lets a junction win over a car that is closer but within the bias', () => {
    const { scene, fromLane, jSp, cam, laneLen, carScreen } = setup();
    // Screen-space unit vector along the approach lane, pointing at the junction.
    const a = carScreen(fromLane, 0);
    const len = Math.hypot(jSp.x - a.x, jSp.y - a.y) || 1;
    const ux = (jSp.x - a.x) / len;
    const uy = (jSp.y - a.y) / len;
    // Click 6px back from the junction; place a car 3px back — closer to the click,
    // but only by 3px (< JUNCTION_BIAS_PX), so the junction should still win.
    const P = { x: jSp.x - ux * 6, y: jSp.y - uy * 6 };
    const carS = laneLen(fromLane) - 3 / cam.scale;
    const carSp = carScreen(fromLane, carS);
    const dJ = Math.hypot(P.x - jSp.x, P.y - jSp.y);
    const dC = Math.hypot(P.x - carSp.x, P.y - carSp.y);
    // The scenario only tests what we mean if the car is genuinely closer, yet within bias.
    expect(dC).toBeLessThan(dJ);
    expect(dJ).toBeLessThanOrEqual(dC + JUNCTION_BIAS_PX);

    const car: HitCar = { id: 9, key: 1, lane: fromLane, s: carS };
    const sel = hitTest(scene, [car], VIEW, P.x, P.y);
    expect(sel.kind).toBe('junction');
  });

  it('selects a car when you click it away from any junction', () => {
    const { scene, fromLane, laneLen, carScreen } = setup();
    const mid = laneLen(fromLane) / 2;
    const car: HitCar = { id: 42, key: 3, lane: fromLane, s: mid };
    const sp = carScreen(fromLane, mid);
    const sel = hitTest(scene, [car], VIEW, sp.x, sp.y);
    expect(sel).toEqual({ kind: 'car', id: 42, key: 3 });
  });

  it('falls back to the lane when clicking a road with no car or junction near', () => {
    const { scene, fromLane, laneLen, carScreen } = setup();
    const mid = laneLen(fromLane) / 2;
    const sp = carScreen(fromLane, mid);
    const sel = hitTest(scene, [], VIEW, sp.x, sp.y);
    expect(sel.kind).toBe('lane');
    if (sel.kind === 'lane') expect(sel.lane).toBe(fromLane);
  });

  it('selects nothing when clicking empty space', () => {
    const { scene } = setup();
    const sel = hitTest(scene, [], VIEW, 5000, 5000);
    expect(sel).toEqual({ kind: 'none' });
  });
});
