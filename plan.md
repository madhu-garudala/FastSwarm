# FastSwarm — Emergent Agent Civilization on Cerebras

**Real-Time Multi-Agent Swarm Simulation**
Cerebras × Google DeepMind Gemma 4 24-Hour Hackathon (Jun 28–29, 2026)

---

## 0. Read this first (Codex: this is the contract)

This file is the **single source of truth**. It is written to be **one-shot
implementable**: build top to bottom, do not re-architect, do not invent extra
features. When a decision is ambiguous, **prefer the choice that makes the
60-second demo more reliable and more visually spectacular**, not the one that
makes the simulation more "correct." We are shipping a *spectacle that proves a
latency claim*, not a research-grade ALife engine.

### 0.1 Operating contract for autonomous mode (`--ask-for-approval never`)

You are running unattended. There is no human to approve steps, so you must
self-govern with these rules:

- **Build in the order given in §10.** Each numbered step in §10 is a checkpoint.
  Do not start a step until the previous step's "verify" condition passes.
- **Verify after every step.** After writing code for a step, run it
  (`npm run build`, `npm run dev` + a curl against the route, or a small node
  script) and confirm it works before moving on. Prefer many small verified
  steps over one big unverified leap. If a step's verification fails, fix it
  before proceeding — do not pile new code on a broken foundation.
- **Protect the floor.** Step 2 of §10 (the heuristic-only swarm with zero LLM)
  is the protected floor. Once it works, **never** let a later change break it.
  If wiring the LLM (step 3+) destabilizes the rendering swarm, revert the
  breaking change and keep the floor working.
- **Never touch secrets or git history.** Do not print, echo, log, or commit the
  contents of `.env.local` or any API key. Do not run destructive git commands.
  Assume the user handles all `git commit`/`push` themselves (see §1.1).
- **Stay in scope.** Implement exactly what §3–§9 specify. Do not add auth, a
  database, a backend framework, extra demo scenarios, or features not in this
  file. If you finish the protect-list (§11) with time to spare, stop and report
  rather than inventing scope.
- **When genuinely blocked** (e.g. the Cerebras request shape can't be confirmed,
  a dependency won't install on an allowed domain), do not guess silently in a
  way that could burn the build. Make the **most documented, reversible** choice,
  leave a clear `// TODO(human): verify X` comment, and keep going on the parts
  you can. Surface every such TODO in your final summary.
- **Report at the end:** what's built, what was verified and how, every
  `TODO(human)` left behind, and the exact commands to run the dev server and
  reproduce the demo.

**One-line thesis the whole project must prove:**
> Dozens of LLM agents can each *think* every tick and still move in real time —
> because Cerebras runs Gemma 4 31B fast enough that an entire swarm can be
> re-planned faster than a human can blink. On a normal GPU API, the same swarm
> stutters to a crawl. **Speed is the feature.**

**The money shot:** a grid of 30–60 agents visibly swarming, gathering,
trading, and forming territories — with a live "tick clock" showing the whole
swarm re-deciding in well under a second on Cerebras — then a toggle flips the
backend to a standard GPU-hosted OpenAI-compatible model and the **same swarm
visibly stutters and stalls**, tick time jumping 5–15×.

> ⚠️ Build complexity warning: this is the highest-risk of the six ideas. The
> single most important engineering decision below is **§4 (batched ticks)** and
> **§6 (the graceful-degradation ladder)**. If you implement nothing else well,
> implement those. Everything has a defined cut path in §11.

---

## 1. Secrets / API key handling — DO THIS RIGHT

- **Reuse the existing `.env.local` from the sibling PulseOps/FlashOps project.**
  The user maintains it and can rotate keys. Do **not** generate a new key file
  format; match what already exists.
- **Codex bootstrap:** if `.env.local` already exists in the repo root, use it
  as-is and do not overwrite it. If it is missing, create a `.env.local` with
  the variable names below left **blank** for the user to fill, and also write a
  committed `.env.example` documenting the same keys. **Never invent or hardcode
  a key value.** If `CEREBRAS_API_KEY` is empty at runtime, the app should still
  boot and run the heuristic-only swarm (§6 rung 2) so the floor is always
  demoable; surface a clear "no API key — running heuristic only" banner.
- Required environment variables:
  ```
  CEREBRAS_API_KEY=...        # primary, fast path
  BASELINE_API_KEY=...        # second provider for the "looks bad" comparison (see §7)
  BASELINE_BASE_URL=...       # e.g. an OpenAI-compatible GPU host
  BASELINE_MODEL=...          # e.g. gpt-4o-mini or a llama-3.x on a GPU provider
  ```
- The key is **never** hardcoded into any file, commit, or UI, and **never**
  read in the browser. All model calls happen in **server-side Next.js route
  handlers** (`app/api/.../route.ts`) or server actions.
- Confirm `.env*` (except `.env.example`) is in `.gitignore`. If a key was ever
  pasted into a chat, assume it is burned and tell the user to rotate.
- The Cerebras model ID is **`gemma-4-31b`**.
- During demo recording, ensure no key, token, env file, terminal scrollback,
  notification, or email is ever visible on screen (hackathon rule).

### 1.1 Git handling (Codex: hands off)

The **user handles all git operations personally** — `git init`, `add`,
`commit`, `push`, branches. Do **not** run any `git` command. Write and edit
files in the working tree only. Do not auto-commit, do not amend history, do not
`git clean`/`reset --hard`/force-push. Your job ends at "files written and
verified"; the user commits. The only git-adjacent thing you may do is **ensure
a correct `.gitignore` file exists** (containing `.env*`, `node_modules`,
`.next`, etc.) so that when the user commits, secrets are already protected.

**Confirmed API shape (TypeScript, OpenAI-compatible):**
```ts
import OpenAI from "openai";

const cerebras = new OpenAI({
  baseURL: "https://api.cerebras.ai/v1",
  apiKey: process.env.CEREBRAS_API_KEY,
});

const completion = await cerebras.chat.completions.create({
  model: "gemma-4-31b",
  messages: [{ role: "system", content: "..." }, { role: "user", content: "..." }],
  temperature: 0.4,
  max_completion_tokens: 256,        // keep TINY — see §4
  response_format: { type: "json_object" }, // structured output; prompt MUST mention JSON
});
```

> Before writing the orchestration loop, **confirm against current Cerebras docs**
> (linked from the hackathon PDF): `gemma-4-31b` model details, the exact
> structured-output / `response_format` parameter, rate limits, and whether
> `usage` includes a `time_info` object for TTFT/total time. Do **not** rely on
> memory for request shapes — pin them to live docs. The base URL
> `https://api.cerebras.ai/v1` and the TS SDK shape above are verified current.

---

## 2. Stack (locked)

- **Next.js (App Router) + TypeScript**
- **Tailwind + shadcn/ui** for chrome (buttons, sliders, panels)
- **Canvas 2D** for the grid render (NOT React-per-cell — see §5; React reconciler
  cannot repaint 60 agents at animation framerate without jank)
- **Zod** for validating every agent decision JSON
- **Cerebras OpenAI-compatible API**, model `gemma-4-31b`, server-side only
- Second OpenAI-compatible provider for the baseline comparison (§7)
- Vercel for deploy (local dev is fine for the demo; deploy only if time permits)
- **No database, no auth, no persistence** — the whole simulation lives in
  server memory for the session. (Cut item — see §11.)
- **No LangChain / LangGraph / agent frameworks.** Orchestrate with plain
  TypeScript. The "swarm" is a `for` loop over agents plus `Promise.all`.

---

## 3. Product concept

A web app where the user presses **Start** and watches a grid-world come alive.
Each cell-dwelling agent is a tiny autonomous creature with simple drives
(gather food, trade surplus, avoid threats, claim territory). **Every tick,
every living agent makes one LLM call to Gemma 4 on Cerebras to choose its next
action.** Over a few minutes the user watches *emergent* behavior appear that
nobody scripted: clustering around food, trade routes between agents, territory
lines, boom/bust population cycles.

The headline isn't the AI being smart — individual decisions are simple. The
headline is that **dozens of independent minds can all think every tick fast
enough to feel alive**, which is only possible because Cerebras collapses the
per-tick latency. The comparison toggle (§7) makes that visceral.

**This is a spectacle-first build.** The simulation rules are deliberately
simple so the *speed* and the *emergence* carry the demo.

---

## 4. The core loop — BATCHED TICKS (this is the whole ballgame)

### The naïve version that will fail
"60 agents × 1 sequential call per tick" = 60 round trips per tick. Even at
50ms each that's 3 seconds/tick — dead on arrival, and it makes Cerebras look
*slow*, which is the opposite of the point.

### The version you will build
**Fire all agent decisions for a tick concurrently and gate on the slowest.**

```ts
async function runTick(world: World): Promise<World> {
  const t0 = performance.now();

  const living = world.agents.filter(a => a.alive);

  // ALL agents decide in parallel. This is the demo.
  const decisions = await Promise.all(
    living.map(agent => decideAgent(agent, localView(world, agent)))
  );

  const t1 = performance.now();        // <-- this is the headline number

  const next = applyDecisions(world, living, decisions); // pure, deterministic, no LLM
  next.lastTickMs = t1 - t0;
  next.tickIndex = world.tickIndex + 1;
  return next;
}
```

### Non-negotiable rules for `decideAgent`
1. **Tiny prompt, tiny output.** Each agent call sends only its *local view*
   (a small window of the grid around it + its own inventory/state), NOT the
   whole world. Output is a single small JSON object. Cap
   `max_completion_tokens` at ~**64–128**. The shorter the output, the faster
   the tick, the better Cerebras looks.
2. **One call per agent per tick. No agent-to-agent chit-chat sub-calls.**
   Trade/alliance "negotiation" is resolved by *deterministic code* in
   `applyDecisions` based on the actions each agent independently chose, not by
   extra LLM calls. (Two agents that both chose "trade" on an adjacent cell →
   code executes the trade.)
3. **`Promise.all` over the whole living set**, optionally chunked to respect
   rate limits (see §4.1). The wall-clock of the slowest call ≈ the tick time.
4. **Never block the render on the network.** The render loop (§5) runs off the
   latest committed world state at its own framerate; ticks update that state
   asynchronously.

### 4.1 Rate-limit & concurrency safety
Cerebras free/dev tiers cap requests/min and concurrent requests. Before
trusting raw `Promise.all` over 60 agents:
- Add a **concurrency limiter** (e.g. a small p-limit style semaphore,
  configurable `MAX_CONCURRENCY`, default 16). If the provider 429s, the tick
  still completes; it just fans out in a couple of waves.
- On any per-agent call failure (429, 5xx, timeout, unparseable JSON): **do not
  crash the tick.** That agent falls back to a **deterministic local heuristic**
  move (see §6) for this tick. Log it. The swarm never freezes because one call
  failed.
- Make `MAX_CONCURRENCY`, `AGENT_COUNT`, and `TICK_INTERVAL_MS` env- or
  UI-tunable so you can dial the swarm down live if the venue wifi is bad.

### 4.2 Where the loop runs
Run the tick loop **server-side** and stream world snapshots to the client over
an SSE endpoint (`app/api/stream/route.ts`) or a polling endpoint the client
hits every ~100ms. The browser must never hold the API key or call the model.
Server holds the authoritative `World`; client renders snapshots.

> Simplest reliable architecture for one-shot: a single in-memory `World` on the
> server, a `POST /api/tick` that advances exactly one tick and returns the new
> snapshot, and a client `setInterval` that calls it and repaints. SSE is nicer
> but the request/response tick is more robust to one-shot bugs. **Default to
> the polling tick; upgrade to SSE only if time permits.**

---

## 5. The world model & render (locked)

### World state (server-authoritative, pure data)
```ts
type Cell = { x: number; y: number; food: number; owner: number | null };
type Agent = {
  id: number;
  x: number; y: number;
  alive: boolean;
  energy: number;          // dies at 0; gather food to restore
  inventory: number;       // surplus food it can trade
  faction: number;         // color group; can change via alliance
  memoryNote: string;      // ≤1 short line the agent may carry tick-to-tick
};
type World = {
  width: number; height: number;
  grid: Cell[];            // width*height
  agents: Agent[];
  tickIndex: number;
  lastTickMs: number;
  backend: "cerebras" | "baseline";
};
```

### Grid size & agent count (demo-tuned defaults)
- Grid **24×24** (576 cells). Big enough to look like a world, small enough to
  render and reason about.
- **40 agents** default (range 10–60 via slider). 40 is the sweet spot: dense
  enough to swarm visibly, small enough that one tick stays well under a second
  on Cerebras.

### Render: Canvas 2D, decoupled from ticks
- Use a single `<canvas>` and a `requestAnimationFrame` loop that draws the
  **latest snapshot**. Do NOT create a React component per cell or per agent.
- Draw order: food heat (cell green intensity) → territory tint (faction color
  per owned cell) → agents (colored dots/triangles by faction) → optional motion
  trails.
- **Interpolate agent positions** between the old and new snapshot over the tick
  interval so movement looks like gliding, not teleporting. This single touch is
  what turns "dots updating" into "a living swarm." Spend polish budget here.
- Overlay HUD (can be plain DOM over the canvas): **tick #**, **last tick ms
  (huge, bold)**, **agents alive**, **rolling avg tick ms**, **current backend
  badge**.

### The "emergence" the audience should see (all from simple rules)
- **Clustering:** agents move toward visible food → crowds form on rich cells.
- **Trade lines:** adjacent agents both choosing trade → brief link drawn → food
  flows from surplus to need. Over time, repeated trades between the same pair
  read as a "route."
- **Territory:** an agent that stays and "claims" a cell tints it its faction
  color; contiguous tinted regions look like nations.
- **Boom/bust:** food regrows slowly; overcrowding starves a region; population
  visibly thins then redistributes. This cyclic motion is the spectacle.

You do **not** need real culture/markets/alliances modeled rigorously. You need
**simple local rules whose aggregate looks like** culture, markets, and
alliances. Tune the rules so the visual reads well in 60 seconds.

---

## 6. Agent decision contract + the degradation ladder

### The single agent call
**Input (local view only):**
```json
{
  "you": { "energy": 7, "inventory": 2, "faction": 1, "note": "heading north for food" },
  "nearby_cells": [
    { "dx": -1, "dy": 0, "food": 3, "owner": null },
    { "dx": 0, "dy": 0, "food": 0, "owner": 1 },
    { "dx": 1, "dy": 0, "food": 5, "owner": 2 }
  ],
  "nearby_agents": [
    { "dx": 1, "dy": 0, "faction": 2, "inventory": 4 }
  ]
}
```

**Output (strict, tiny):**
```json
{
  "action": "move | gather | trade | claim | rest",
  "dir": "N | S | E | W | NONE",
  "note": "≤8 word intention to carry next tick"
}
```

- **System prompt** describes the creature's drives in a few sentences:
  survive (energy), eat (gather/move toward food), trade surplus with neighbors,
  claim good cells, rest if safe. Keep it short — long prompts slow the tick.
- **Validate with Zod.** Invalid/unparseable → one cheap repair retry is *too
  slow at swarm scale*; instead **fall straight to the heuristic** (below) for
  that agent this tick. Reliability over cleverness.

### The degradation ladder (THIS is what keeps the demo alive)
Each agent's move is resolved by the first rung that succeeds:
1. **LLM decision** (Gemma 4 on Cerebras) — the real thing.
2. **Heuristic fallback** (pure TS, no network): if no valid LLM JSON in time,
   pick a sane move — step toward the richest visible food cell; gather if on
   food; trade if a neighbor has surplus and you don't; else rest. This is
   deterministic and instant.
3. **No-op:** if even the heuristic can't act (boxed in), the agent rests.

Because rung 2 is always available, **the swarm keeps moving even if every LLM
call fails.** The LLM makes the behavior *interesting and varied*; the heuristic
guarantees the spectacle *never freezes on camera*. Build the heuristic FIRST
(§10 step 2) so you always have a working visual, then layer the LLM on top.

> Honesty note: the heuristic is a safety net, not a cheat. The headline tick-ms
> number must reflect **real LLM round trips** when the backend is Cerebras. Do
> not silently run the whole swarm on heuristics and claim it's the model. If a
> tick is mostly heuristic due to failures, surface that (e.g. a small "N/40
> agents thinking" counter) rather than faking it.

---

## 7. The comparison — "look how bad the GPU/OpenAI setup is" (locked, honest)

This is a headline feature, so do it **fairly** or judges will discount it.

### Mechanism
- A backend **toggle** in the UI: **Cerebras (gemma-4-31b)** ⟷ **Baseline GPU
  (OpenAI-compatible)**.
- Both paths use the **identical** local-view prompt, identical output schema,
  identical concurrency settings, identical agent count. The *only* thing that
  changes is `baseURL` + `model` + key. Build one `callModel(backend, messages)`
  function parameterized by backend; never two divergent code paths.
- Baseline = a real OpenAI-compatible GPU-hosted model via `BASELINE_BASE_URL` /
  `BASELINE_MODEL` (e.g. an OpenAI `gpt-4o-mini`, or a Llama-3.x on a
  GPU-inference provider). Pick something **credible and comparable**, not a
  deliberately crippled toy. A believable ~**5–10×** slower tick beats a
  suspicious 30×.

### What the audience sees when they flip to baseline
- The **tick-ms HUD number jumps** from (e.g.) ~300–600ms to several seconds.
- The **swarm visibly stutters**: long frozen pauses between snapshots, agents
  lurching instead of gliding, the rolling-average bar ballooning.
- Same world, same rules, same agent count — only the engine changed. The
  contrast *is* the pitch.

### Honesty guardrails (do not skip)
- **Never hardcode either number.** Show only **real measured** per-tick
  wall-clock for whichever backend is live.
- Measure & display: **per-tick total ms**, **rolling average ms**, and if the
  provider returns it, **TTFT** and **tokens/sec**.
- Run the baseline **live** if it's stable on venue wifi; if not, you may show a
  **pre-recorded honest clip** of the baseline — clearly, not passed off as
  live. Same prompt, same swarm.
- Keep agent count identical across backends during the comparison. Changing the
  swarm size mid-comparison would be cheating; don't.

> Optional intensifier (only if §11 protect-list is done): plot a live
> **tick-time sparkline** that keeps history across the toggle, so flipping
> backends draws a dramatic step in the same chart.

---

## 8. The one beautiful moment (where the polish budget goes)

Everything can be clean shadcn defaults **except** the grid spectacle, which
must feel premium:

> Press **Start** → the grid blooms with food → agents **glide** outward and
> swarm toward green → trade links flicker between neighbors → territory colors
> spread like watercolor → the **giant tick-ms readout** ticks over fast and
> calm. Then **flip to Baseline** → the same swarm **seizes up**, the readout
> balloons, motion turns to lurching — and flip back to Cerebras and it
> **breathes again**.

Spend polish on: smooth position interpolation, faction color palette, food
heat gradient, the big tick-ms number, and the toggle transition. Nothing else
needs to be pretty.

---

## 9. Suggested layout

- **Center (dominant):** the canvas grid — the swarm. Largest element on screen.
- **Top bar / HUD over canvas:** big **last-tick ms**, tick #, agents alive,
  rolling avg ms, **backend badge** (Cerebras green / Baseline grey).
- **Right rail (shadcn):** Start/Pause/Reset; sliders for **agent count**,
  **tick interval**, **max concurrency**; the **backend toggle**; the
  tick-time **sparkline**.
- **Bottom strip (optional):** a tiny live event log ("agent 12 traded with 7",
  "faction 2 claimed cell 9,14") to make emergence legible — purely cosmetic,
  generated by `applyDecisions`, no LLM.

---

## 10. Build order (de-risk the fragile things first — checkpoint-gated)

> Cerebras engineers are reportedly online **Sun 10:30–12:30 PT** — get your
> bare model call and structured-output question answered in that window.

**Codex: each step below is a checkpoint. Do not advance until its `VERIFY`
passes. If `VERIFY` fails, fix the current step before writing any code for the
next one.**

0. **Scaffold.** `npx create-next-app@latest` (App Router, TypeScript,
   Tailwind), add shadcn/ui, add `openai` and `zod`. Write `.gitignore` with
   `.env*`, `node_modules`, `.next`. Write `.env.example`.
   **VERIFY:** `npm run dev` boots a blank page with no errors; `npm run build`
   succeeds.

1. **One bare Cerebras call** from a server route: `gemma-4-31b`,
   `response_format: { type: "json_object" }`, returning the agent decision
   schema for a single hardcoded local view. Add Zod validation + defensive
   parse.
   **VERIFY:** `curl -X POST localhost:3000/api/decide-test` (a temporary route)
   returns valid JSON that passes Zod, 3 times in a row. If `CEREBRAS_API_KEY`
   is blank, this step is skipped and noted as `TODO(human)`; proceed to step 2.

2. **Build the whole simulation with ZERO LLM** — pure heuristic agents (§6 rung
   2) rendering on the canvas with interpolation. This is the **protected floor.**
   **VERIFY:** pressing Start shows ≥20 agents gliding on a 24×24 grid, moving
   toward food, with visible clustering over ~30s, and no console errors. This
   must keep working through every later step.

3. **Swap in the LLM decision per agent** behind `decideAgent`, with the
   degradation ladder (LLM → heuristic → no-op) so failures fall back silently.
   Run **1 agent** on the LLM first, then 5, then the full swarm.
   **VERIFY:** at least one agent's move is demonstrably model-chosen (log it),
   and killing the network (or blanking the key) makes the swarm fall fully to
   heuristic **without freezing or erroring**.

4. **Batch the tick** with `Promise.all` + concurrency limiter (§4). **Measure
   real per-tick wall-clock** and show it in the HUD.
   **VERIFY:** a 40-agent Cerebras tick completes and the HUD shows a real,
   changing per-tick ms number (not hardcoded). If it creeps past ~1s, tune
   `max_completion_tokens`, local-view size, agent count, concurrency until it
   feels live. Confirm JSON stays parseable under the 40-wide fan-out.

5. **Wire the baseline backend** and the toggle via the single parameterized
   `callModel` (§7). Same code path, only env differs.
   **VERIFY:** toggling to Baseline visibly raises the measured tick-ms and makes
   the swarm stutter; toggling back to Cerebras restores smooth motion. Both
   numbers are real and measured. (If `BASELINE_*` env is blank, leave the toggle
   wired but disabled with a `TODO(human): set BASELINE_* to enable comparison`.)

6. **Polish the one beautiful moment** (§8): interpolation, colors, the big
   readout, the toggle transition, the sparkline.
   **VERIFY:** the chaos→swarm→toggle sequence reads well in a 60s screen capture
   with no jank on the Cerebras path.

7. **Stop and report.** Do not deploy or run git. Print the run instructions, the
   verified state of each checkpoint, and all `TODO(human)` items. The user
   handles commit, deploy, and recording.

> Confirm strict JSON works under concurrency early — structured output that's
> fine for one call can get flaky under a 40-wide fan-out. The heuristic
> fallback (step 2) must exist before the LLM (step 3), not after.

---

## 11. Scope: protect vs cut

**Protect at all costs:**
1. The canvas swarm that **glides and looks alive** (works on heuristics alone).
2. Per-agent LLM decisions on Cerebras with the degradation ladder.
3. **Batched tick** with real measured per-tick latency, shown huge.
4. The **backend toggle** showing Cerebras vs baseline, honestly measured.
5. One smooth, beautiful spectacle + one clean comparison.

**Cut first (in this order) if behind:**
1. Live event log / sparkline.
2. SSE streaming → fall back to polling tick.
3. Trade/alliance complexity → keep only gather + move + claim.
4. Baseline **live** → use the honest pre-recorded baseline clip.
5. Agent count → drop to 20, or even 10, if latency/wifi demands it.
6. LLM decisions entirely → if the model path is on fire at hour 20, demo the
   **heuristic swarm** + the *measured* single-agent Cerebras latency as proof
   of speed, and frame the swarm as the visualization. (Last resort — say so
   honestly; don't claim the swarm is LLM-driven if it isn't.)

If badly behind: a **heuristic-only swarm that glides beautifully** plus a
**real, measured Cerebras-vs-baseline latency comparison on a single agent loop**
is still a coherent, honest, spectacular submission.

---

## 12. Three submissions from one build (same app, different framing)

- **Track 1 — Multiverse Agents (PRIMARY):** lead with *dozens of independent
  LLM agents each thinking every tick*, emergent trade/territory/factions, and
  the batched-tick speed that makes a real-time swarm possible only on Cerebras.
  This is the strongest agent story of the six ideas.
- **Track 3 — Enterprise Impact (SECONDARY):** reframe as *massively parallel
  agentic simulation* — the same primitive (N independent agents re-deciding
  per tick in real time) underlies swarm robotics, market/risk simulation,
  logistics, and digital-twin scenario testing. Pitch: Cerebras makes
  large-population agent simulation interactive instead of batch/overnight.
- **Track 2 — People's Choice (minimal energy):** post the best ~30–60s cut to
  X — the swarm gliding, then the dramatic Cerebras⟷baseline stutter toggle.
  Tag **@Cerebras** and **@googlegemma**. Don't build social features; given
  modest reach, deprioritize per the established track strategy.

Each track = a separate Discord post in its channel. Video ≤ 60s, must show
Cerebras speed, no sensitive info on screen. **Deadline: Mon Jun 29, 10:00 AM PT.**

---

## 13. Non-negotiables checklist

- [ ] Keys only in git-ignored `.env.local` (reused from sibling project), read
      server-side via `CEREBRAS_API_KEY` / `BASELINE_*`; never in the browser
- [ ] `.env*` (except `.env.example`) confirmed in `.gitignore`; Codex runs no git commands
- [ ] `gemma-4-31b` via `https://api.cerebras.ai/v1`, request shape & structured
      output confirmed against live Cerebras docs
- [ ] Heuristic-only swarm renders and glides BEFORE any LLM is wired (the floor)
- [ ] Tick is **batched** (`Promise.all` + concurrency limiter), not sequential
- [ ] Every agent decision Zod-validated; failures fall to heuristic, never crash
- [ ] Per-tick latency is **real, measured, never hardcoded**, shown large
- [ ] Backend toggle uses one parameterized `callModel`; only env differs
- [ ] Baseline comparison is fair (same prompt/schema/agent count) and honest
      (live or clearly-labeled pre-recorded)
- [ ] Canvas render decoupled from network; positions interpolated for glide
- [ ] If swarm runs partly on heuristics due to failures, that's surfaced, not faked
- [ ] Nothing sensitive visible in the recording

---

## 14. Quick reference — files to create

```
app/
  api/
    tick/route.ts          # POST: advance one tick, return World snapshot
    reset/route.ts         # POST: re-init world (agent count, grid size)
    (stream/route.ts)      # OPTIONAL SSE upgrade — only if time permits
  page.tsx                 # canvas + HUD + right-rail controls
lib/
  world.ts                 # World/Agent/Cell types, init, food regrow
  tick.ts                  # runTick, applyDecisions (pure), localView
  decide.ts                # decideAgent: LLM call + Zod + heuristic ladder
  callModel.ts             # parameterized Cerebras|baseline OpenAI-compatible call
  heuristic.ts             # deterministic fallback move
  schema.ts                # Zod schemas for agent decision
components/
  SwarmCanvas.tsx          # canvas + rAF render + interpolation
  Hud.tsx                  # tick ms, counts, backend badge, sparkline
  Controls.tsx             # start/pause/reset, sliders, backend toggle
.env.local                 # REUSED from sibling project (git-ignored)
```

Build `world.ts → heuristic.ts → tick.ts → SwarmCanvas.tsx` first (the floor),
then `callModel.ts → decide.ts` (the LLM), then `Controls.tsx` toggle + baseline
(the comparison), then polish.
