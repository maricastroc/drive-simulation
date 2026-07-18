<h1 align="center">
  <br>
  <img src="public/app-icon.svg" alt="Urban Flow" width="40">
  <br>
  Urban Flow
  <br>
</h1>

<h4 align="center">A deterministic, agent-based traffic simulation you can experiment on — close roads, retune demand, watch the network reroute, then run controlled experiments (or let it auto-search) to find what actually helps.</h4>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=next.js&logoColor=white" alt="Next.js" />
  <img src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/Canvas-E34F26?style=for-the-badge&logo=html5&logoColor=white" alt="HTML5 Canvas" />
  <img src="https://img.shields.io/badge/Vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white" alt="Vitest" />
</p>

🔗 Live demo: urban-system.marianacastro.dev

<p align="center">
  <a href="#-features">Features</a> •
  <a href="#-the-simulation-engine">Simulation Engine</a> •
  <a href="#-tech-stack">Tech Stack</a> •
  <a href="#ℹ%EF%B8%8F-how-to-run-the-application">How To Run</a> •
  <a href="#-license">License</a>
</p>

<p align="center">
  Not a video of traffic — a live system. A pure, seeded simulation core (bit-for-bit reproducible) drives a Canvas visualization where roads, junctions and vehicles all speak one thermal language: <strong>cool = flowing, hot = congested</strong>.
</p>

<br/>

## 🚗 Features

|                              |                                                                                                                                                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **🚙 Agent-based cars**      | Every vehicle is an autonomous agent following the Intelligent Driver Model (IDM) — accelerating to its desired speed, keeping a safe headway, and queueing — with a stable integrator that never reverses and never overlaps. |
| **🧭 Shortest-path routing** | Cars are routed by Dijkstra over the lane graph to a destination, and **detour automatically** when a road ahead is closed.                                                                                                 |
| **🚦 Give-way & signals**    | Junctions resolve conflicts by strict-priority gap acceptance (unique ranks ⇒ deadlock-free), or switch — per junction, live — to a fixed-cycle traffic signal.                                                             |
| **🧪 Scenario control**      | Close / reopen roads, drop incidents, retune demand per entry, choose destinations, and flip right-of-way. The network reroutes and re-settles in real time.                                                                |
| **⚡ One-click scenarios**   | Preset situations — _rush hour_, _close the artery_, _signalize the centre_ — each stage a fresh, same-seed network, ready to watch live or run an experiment on.                                                            |
| **📊 Controlled A/B**        | Stage a change (a closure, a signal…), then run baseline vs. your change on two **same-seed** worlds for the same duration — so the impact on trips, speed and travel time is _your change_, not elapsed time or noise. Runs headless; a fast-forward skips the wait for traffic to build.                                                              |
| **🔎 Auto-optimizer**        | Let the simulation search for you: it sweeps every single-junction fix (signalize / flip priority) as a controlled **same-seed** experiment, ranks them by throughput, and surfaces a **leaderboard of what actually helps** — click a result to stage it on the live network and confirm it with the A/B.                                             |
| **🌡️ Living thermal map**    | Roads, junctions, flow and cars share one heat language: congestion warms the mesh, an always-on flow field shows each street's direction without cars, and critical junctions glow.                                         |
| **🎯 Focus & inspect**       | Click any road, junction **or car** to spotlight it — the rest of the network recedes — and read its live stats: cars, speed, queue length, signal phase. Select a car and its **Dijkstra route** lights up all the way to its exit.                                                                                                                   |
| **📈 Live metrics**          | A top-bar HUD with rolling **sparklines** for throughput and speed, so the network's dynamics read over time — not just as a single number.                                                                                 |
| **♻️ Deterministic & tested** | Same world + same seed → identical run, bit for bit. The pure engine (IDM, routing, give-way, signals) is fully unit-tested with Vitest.                                                                                    |

<br/>

## 🧠 The simulation engine

Urban Flow runs on a **pure, framework-free core** (`src/engine/`) — plain-data structs and free functions, no DOM and no React — wrapped by a thin Canvas + React shell. The core is a fixed-step, deterministic simulation whose every tick is a fixed pipeline ([`src/engine/simulation.ts`](src/engine/simulation.ts)):

```
tick(world):
  FASE S  updateSignals   advance every traffic-signal phase
  FASE 0  spawn           inject demand (seeded Bernoulli arrivals)
  FASE 1  accelerations   IDM, read-only — order-independent
  FASE 2  integrate       ballistic step, front → back per lane
  FASE 3  advance         cross junctions + despawn (record metrics)
```

- **Deterministic by construction** — fixed `dt = 0.2s`, a seeded `mulberry32` PRNG, fixed iteration order, and a two-phase _read-all-then-write-all_ update. Same world + same seed → identical state, so the core is testable offline with fixtures — and it powers the **controlled A/B**: baseline and intervention run on two same-seed worlds for the same duration, so the delta is the change, not time or noise. The **optimizer** cashes the same property in at scale, sweeping every candidate intervention headless against one shared baseline to rank what helps.
- **Structure-of-Arrays** — agent state lives in typed arrays (cache-friendly, and transferable across a Web Worker / `SharedArrayBuffer` boundary later, with no reshaping).
- **Car-following (IDM)** — `idmAcceleration` is the pure Intelligent Driver Model; `integrate` uses a ballistic scheme with a stop-handling branch so a car brakes to rest _within_ a step instead of reversing, plus an overlap guard against the car ahead.
- **The no-overtaking invariant** — with a single lane per direction, cars never reorder within a lane, so the per-lane ordered list is only ever mutated at the back (entry) and front (exit). That is the subtle correctness core that keeps the network provably overlap-free without any sorting.
- **Give-way** — strict-priority gap acceptance: a movement yields only to a strictly-higher-rank conflicting movement that has an approaching car. Ranks are unique per node, so the top movement never yields ⇒ **no deadlock**.
- **Routing** — Dijkstra with a binary min-heap over the lane graph; routes are per-OD (a shared, append-only buffer) and detour around closed lanes.
- **Scenario overlay** — closures, incidents, priority flips and signals are a flat typed-array overlay on top of the immutable graph. The defaults reproduce the plain network exactly, so the whole experimentation layer never touches — or risks — the tested core.

<br/>

## 🧰 Tech Stack

<p>
  <img src="https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=next.js&logoColor=white" alt="Next.js" />
  <img src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/Canvas-E34F26?style=for-the-badge&logo=html5&logoColor=white" alt="HTML5 Canvas" />
  <img src="https://img.shields.io/badge/Vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white" alt="Vitest" />
</p>

| Category            | Technologies                                                              |
| ------------------- | ------------------------------------------------------------------------- |
| **Framework**       | Next.js 16 (App Router), React 19                                         |
| **Language**        | TypeScript 5                                                              |
| **Styling**         | Tailwind CSS v4                                                           |
| **Rendering**       | HTML5 Canvas 2D — no WebGL, no rendering libraries                        |
| **Simulation core** | Framework-free TypeScript (Structure-of-Arrays typed arrays, seeded PRNG) |
| **Testing**         | Vitest                                                                    |
| **Tooling**         | ESLint                                                                    |

<br/>

## 📝 Project Description

Urban Flow is an agent-based urban-traffic simulation built around a strict separation: a **pure, deterministic functional core** and an **imperative Canvas + React shell**. All simulation logic lives in `src/engine/` as plain-data structs and free functions with no framework dependency; the render layer (`src/render/`) maps the engine's metric / topological world to pixels; and a single client component (`src/components/`) runs the fixed-step loop and the UI.

The world is a procedurally generated one-way Manhattan grid: cars enter at the perimeter, are routed by shortest path to an exit, and give way (or obey signals) at each junction as they cross the network. On top of that sits a live **experimentation layer** — everything you can change (close a road, stage an incident, retune demand, pick destinations, flip priority, add signals) is applied as a flat overlay on the immutable graph, so the network reroutes and re-settles in real time without ever rebuilding or touching the tested core.

The visualization treats the mesh as a **living thermal field** rather than a diagram: one colour language (cool = flowing → hot = congested) runs through the roads, the junctions, an ambient flow field and the cars, so you can read where the system is under load without looking at a single number. Selecting any element spotlights it and its immediate topology while the rest of the network recedes.

The architecture, the tick pipeline and every design decision are documented in [`docs/DESIGN.md`](docs/DESIGN.md), with the incremental build history in [`docs/PROGRESS.md`](docs/PROGRESS.md).

<br/>

## 🛠️ Engineering challenges

The hardest part was **correctness under a moving target** — keeping the network provably overlap-free _and_ deterministic while agents spawn, follow, cross junctions and despawn on every tick. The two-phase (read-all-then-write-all) update, the ballistic integrator's stop branch, and the per-lane ordered list (mutated only at its ends) are what make _no reversing, no overlap, bit-for-bit reproducible_ hold — properties I could only trust by unit-testing the pure core in isolation with fixed seeds.

The second challenge was visual. Once the mesh became a live heat map, the individual vehicles started dissolving into the road glow — so the agents were lifted into their own luminance tier (a bright, dark-separated capsule with a near-white nose) to stay pickable at a glance without breaking the elegance of the system-level view.

The third was turning determinism from a _correctness_ property into a _product_ one — from "the run reproduces" to "the model can decide." A single reproducible run is table stakes; the payoff is comparison. The controlled A/B uses it directly — baseline vs. change on two same-seed worlds for the same duration, so the only variable is the change — and the **optimizer** pushes it to the limit, sweeping every candidate intervention as its own controlled experiment and ranking them by throughput. The work was making that both honest and responsive: measure every candidate against **one shared baseline** (so ~50 fixes cost ~51 headless runs, not ~100), and drive the sweep in chunks off `setTimeout` so it streams live progress, never blocks the frame loop, and still finishes in a throttled background tab — where a `requestAnimationFrame` loop would stall.

<br/>

## ℹ️ How to run the application?

> The app is fully client-side — no database, API keys, or environment setup required.

> Clone the repository:

```bash
git clone https://github.com/maricastroc/drive-simulation
```

> Install the dependencies:

```bash
npm install
```

> Start the dev server:

```bash
npm run dev
```

> Run the tests:

```bash
npm run test
```

> ⏩ Access [http://localhost:3000](http://localhost:3000) to view the simulation.

<br/>

## 📄 License

Released under the [MIT License](LICENSE). You're free to use, study, fork and build on this code — **as long as the original copyright and license notice are kept**. Reuse it and learn from it; don't strip the attribution and present it as your own.

© 2025–2026 Mariana Castro

<br/>

<div align="center">

⭐ If you like this project, give it a star on GitHub!

</div>
