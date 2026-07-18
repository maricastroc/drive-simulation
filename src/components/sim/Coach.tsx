import { IconClose } from './icons';

const COACH_STEPS = [
  { title: 'Stage an intervention', body: 'Click a road to close it, or a junction to add signals or flip priority.' },
  { title: 'Run the controlled A/B', body: 'It re-runs baseline vs. your change from the same seed — so the delta is your change.' },
];

export function Coach({ step, onDismiss }: { step: number; onDismiss: () => void }) {
  const s = COACH_STEPS[Math.min(step, COACH_STEPS.length - 1)];
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-24 flex justify-center px-3">
      <div
        className="anim-up pointer-events-auto flex max-w-105 items-start gap-3 rounded-xl border border-(--border-strong) bg-(--surface-1)/95 py-2.5 pl-3 pr-2.5 backdrop-blur-md"
        style={{ boxShadow: 'var(--shadow-float)' }}
      >
        <div className="tnum mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-(--accent-soft) text-[11px] font-bold text-(--accent-2)">
          {step + 1}
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold leading-tight">{s.title}</div>
          <div className="mt-0.5 text-[12px] leading-snug text-(--text-2)">{s.body}</div>
          <div className="mt-2 flex items-center gap-1.5">
            {COACH_STEPS.map((_, i) => (
              <span
                key={i}
                className="h-1 rounded-full transition-all duration-300"
                style={{ width: i === step ? 18 : 6, background: i <= step ? 'var(--accent)' : 'var(--border-strong)' }}
              />
            ))}
          </div>
        </div>
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-(--text-3) transition-colors hover:bg-(--surface-3) hover:text-(--text-1)"
        >
          <IconClose />
        </button>
      </div>
    </div>
  );
}
