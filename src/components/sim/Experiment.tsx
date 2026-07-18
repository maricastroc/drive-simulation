import type { Stats, ExperimentResult } from '@/render/scene';
import { EXPERIMENT_DURATIONS } from '@/render/scene';
import { CARD } from './ui';
import { IconArrow, IconFlask } from './icons';

const METRICS: { label: string; get: (s: Stats) => number; fmt: (n: number) => string; better: 'up' | 'down' }[] = [
  { label: 'Trips completed', get: (s) => s.completedTrips, fmt: (n) => String(Math.round(n)), better: 'up' },
  { label: 'Avg speed', get: (s) => s.avgSpeedKmh, fmt: (n) => `${Math.round(n)} km/h`, better: 'up' },
  { label: 'Avg trip time', get: (s) => s.avgTravelTime, fmt: (n) => (n ? `${Math.round(n)} s` : '—'), better: 'down' },
];

const mins = (ticks: number) => `${Math.round(ticks / 300)} min`;

export function Experiment({
  result,
  running,
  duration,
  onDuration,
  onRun,
  hasIntervention,
  highlight,
}: {
  result: ExperimentResult | null;
  running: boolean;
  duration: number;
  onDuration: (ticks: number) => void;
  onRun: () => void;
  hasIntervention: boolean;
  highlight: boolean;
}) {
  return (
    <section className={`${CARD} p-4`}>
      <div className="mb-3 flex items-center gap-2">
        <IconFlask />
        <div className="eyebrow">Controlled experiment · A/B</div>
      </div>

      <div className="eyebrow mb-1.5">Simulation time</div>
      <div className="mb-2 flex rounded-lg bg-(--surface-3) p-0.5">
        {EXPERIMENT_DURATIONS.map((t) => (
          <button
            key={t}
            onClick={() => onDuration(t)}
            className={`tnum flex-1 rounded-md py-1 text-[11px] font-semibold transition-colors ${
              duration === t
                ? 'bg-(--surface-1) text-(--text-1) ring-1 ring-(--border)'
                : 'text-(--text-3) hover:text-(--text-2)'
            }`}
          >
            {mins(t)}
          </button>
        ))}
      </div>

      <button
        onClick={onRun}
        disabled={running || !hasIntervention}
        className={`w-full rounded-lg px-3 py-2 text-[13px] font-semibold transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
          running ? 'bg-(--surface-2) text-(--text-2)' : 'bg-(--accent) text-white hover:brightness-110'
        } ${highlight ? 'hint-ring' : ''}`}
      >
        {running ? 'Running…' : result ? 'Run again' : 'Run experiment'}
      </button>

      {!hasIntervention && !result && (
        <p className="mt-3 text-[12px] leading-relaxed text-(--text-3)">
          Stage a change first — close a road, add a signal, or flip priority — then run it. Baseline
          vs. your change, from the <strong className="text-(--text-2)">same seed</strong> for the same {mins(duration)}.
        </p>
      )}

      {result && (
        <div className="mt-3">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="eyebrow">Baseline → change</span>
            {result.changes.map((c) => (
              <span
                key={c}
                className="tnum rounded-md bg-(--surface-3) px-2 py-0.5 text-[10px] font-semibold text-(--text-2)"
              >
                {c}
              </span>
            ))}
          </div>
          <div className="flex flex-col gap-1">
            {METRICS.map((m) => {
              const a = m.get(result.baseline);
              const b = m.get(result.intervention);
              return (
                <ImpactRow key={m.label} label={m.label} a={m.fmt(a)} b={m.fmt(b)} delta={b - a} better={m.better} rel={a ? (b - a) / Math.abs(a) : 0} />
              );
            })}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-(--text-3)">
            Both ran from the same seed for {mins(result.durationTicks)} — the delta is your change, not
            time or noise.
          </p>
        </div>
      )}
    </section>
  );
}

function ImpactRow({
  label,
  a,
  b,
  delta,
  better,
  rel,
}: {
  label: string;
  a: string;
  b: string;
  delta: number;
  better: 'up' | 'down';
  rel: number;
}) {
  const improved = Math.abs(delta) < 1e-6 ? null : (delta > 0) === (better === 'up');
  const tone = improved === null ? 'var(--text-3)' : improved ? 'var(--good)' : 'var(--bad)';
  const pct = Math.max(-1, Math.min(1, rel));
  return (
    <div className="py-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] text-(--text-2)">{label}</span>
        <div className="flex items-center gap-2">
          <span className="tnum text-[12px] text-(--text-3)">{a}</span>
          <IconArrow />
          <span className="tnum text-[12.5px] font-semibold text-(--text-1)">{b}</span>
          <span className="tnum w-14 text-right text-[11px] font-semibold" style={{ color: tone }}>
            {improved === null ? '±0' : `${delta > 0 ? '+' : ''}${(rel * 100).toFixed(0)}%`}
          </span>
        </div>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-(--surface-3)">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.abs(pct) * 100}%`, marginLeft: pct < 0 ? `${(1 - Math.abs(pct)) * 100}%` : 0, background: tone }} />
      </div>
    </div>
  );
}
