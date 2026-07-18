export interface SparkSeries {
  readonly cap: number;
  values: number[];
}

export function createSeries(cap: number): SparkSeries {
  return { cap, values: [] };
}

export function pushSample(series: SparkSeries, v: number): void {
  series.values.push(v);
  if (series.values.length > series.cap) series.values.shift();
}

export interface SparkGeometry {
  line: string;
  area: string;
  head: { x: number; y: number };
  empty: boolean;
}

export interface SparkOpts {
  width: number;
  height: number;
  cap: number;
  min?: number;
  max?: number;
  pad?: number;
  floor?: number;
}

export function sparkGeometry(values: number[], opts: SparkOpts): SparkGeometry {
  const { width, height, cap } = opts;
  const pad = opts.pad ?? 1;
  const min = opts.min ?? 0;
  const floor = opts.floor ?? 1;
  const n = values.length;
  const baseY = height - pad;

  if (n === 0) return { line: '', area: '', head: { x: width, y: baseY }, empty: true };

  const max = opts.max ?? Math.max(floor, ...values);
  const span = max - min || 1;
  const dx = cap > 1 ? width / (cap - 1) : 0;
  const usableH = height - 2 * pad;

  const yOf = (v: number) => {
    const t = Math.min(1, Math.max(0, (v - min) / span));
    return baseY - t * usableH;
  };
  const xOf = (i: number) => width - (n - 1 - i) * dx;

  const pts: string[] = [];
  for (let i = 0; i < n; i++) pts.push(`${round(xOf(i))},${round(yOf(values[i]))}`);

  const x0 = round(xOf(0));
  const xL = round(xOf(n - 1));
  const area = `M${x0},${baseY} L${pts.join(' L')} L${xL},${baseY} Z`;
  return {
    line: pts.join(' '),
    area,
    head: { x: xOf(n - 1), y: yOf(values[n - 1]) },
    empty: false,
  };
}

const round = (v: number) => Math.round(v * 100) / 100;
