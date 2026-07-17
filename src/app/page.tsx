import { SimulationCanvas } from '@/components/SimulationCanvas';

export default function Home() {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <header className="mb-8">
          <p className="mb-2 font-mono text-xs uppercase tracking-widest text-emerald-400/80">
            Traffic engine · Etapa 5 — routing
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Urban Flow</h1>
          <p className="mt-2 max-w-prose text-neutral-400">
            An agent-based mobility simulation on a deterministic fixed-step engine. Cars follow
            the Intelligent Driver Model; colour encodes speed, from green (free flow) to red
            (stopped). Each car is routed by shortest path (Dijkstra) to a destination: at the
            fork, some continue straight while others turn — each choosing its own exit.
          </p>
        </header>
        <SimulationCanvas />
      </div>
    </main>
  );
}
