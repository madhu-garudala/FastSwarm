"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SwarmCanvas } from "../components/SwarmCanvas";
import type { Backend, World } from "../lib/sim/types";

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export default function Home() {
  const [world, setWorld] = useState<World | null>(null);
  const [previous, setPrevious] = useState<World | null>(null);
  const [running, setRunning] = useState(false);
  const [backend, setBackend] = useState<Backend>("heuristic");
  const [agentCount, setAgentCount] = useState(40);
  const [tickInterval, setTickInterval] = useState(700);
  const [maxConcurrency, setMaxConcurrency] = useState(16);
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const reset = useCallback(async (nextBackend = backend, nextCount = agentCount) => {
    setError(null);
    setStatus("Resetting world…");
    const response = await fetch("/api/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ backend: nextBackend, agentCount: nextCount }) });
    if (!response.ok) throw new Error(`Reset failed: ${response.status}`);
    const snapshot = (await response.json()) as World;
    setPrevious(null);
    setWorld(snapshot);
    setStatus("Ready");
  }, [agentCount, backend]);

  const tick = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setStatus("Thinking…");
    try {
      const response = await fetch("/api/tick", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ world, backend, agentCount, maxConcurrency, useLlm: backend !== "heuristic" }),
      });
      if (!response.ok) throw new Error(`Tick failed: ${response.status}`);
      const snapshot = (await response.json()) as World;
      setWorld((current) => {
        setPrevious(current);
        return snapshot;
      });
      setStatus("Running");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unknown tick error";
      setError(message);
      setRunning(false);
      setStatus("Paused");
    } finally {
      busyRef.current = false;
    }
  }, [agentCount, backend, maxConcurrency]);

  useEffect(() => { reset("heuristic", 40).catch((caught) => setError(caught instanceof Error ? caught.message : "Reset failed")); }, []);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(tick, tickInterval);
    void tick();
    return () => window.clearInterval(id);
  }, [running, tick, tickInterval]);

  const alive = world?.agents.filter((agent) => agent.alive).length ?? 0;
  const backendLabel = backend === "cerebras" ? "Cerebras gemma-4-31b" : backend === "baseline" ? "Baseline GPU" : "Heuristic floor";
  const baselineDisabled = backend !== "baseline" && world?.baselineReady === false;

  return (
    <main className="min-h-screen p-4 text-slate-100 md:p-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <header className="flex flex-col justify-between gap-3 rounded-3xl border border-white/10 bg-white/10 p-5 shadow-xl shadow-slate-950/30 backdrop-blur md:flex-row md:items-end">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.35em] text-cyan-300">FastSwarm</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight md:text-5xl">Emergent agent civilization at tick speed</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-300">Press Start: agents glide toward food, claim territory, trade, and keep moving even when model calls fall back.</p>
          </div>
          <div className="rounded-3xl border border-cyan-300/30 bg-cyan-300/10 px-6 py-4 text-right">
            <div className="text-xs uppercase tracking-[0.28em] text-cyan-200">last tick</div>
            <div className="text-5xl font-black text-white">{world?.lastTickMs ?? 0}<span className="text-xl text-cyan-200">ms</span></div>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <div className="relative min-h-[560px] overflow-hidden rounded-[2rem]">
            <SwarmCanvas world={world} previous={previous} tickInterval={tickInterval} />
            <div className="pointer-events-none absolute left-5 top-5 flex flex-wrap gap-2 text-sm">
              <span className="rounded-full bg-slate-950/75 px-3 py-2">tick #{world?.tickIndex ?? 0}</span>
              <span className="rounded-full bg-slate-950/75 px-3 py-2">avg {world?.avgTickMs ?? 0}ms</span>
              <span className="rounded-full bg-slate-950/75 px-3 py-2">alive {alive}/{world?.agents.length ?? agentCount}</span>
              <span className="rounded-full bg-slate-950/75 px-3 py-2">{status}</span>
              <span className={classNames("rounded-full px-3 py-2 font-bold", backend === "cerebras" ? "bg-emerald-400 text-emerald-950" : backend === "baseline" ? "bg-zinc-300 text-zinc-950" : "bg-amber-300 text-amber-950")}>{backendLabel}</span>
              {world?.noKey && backend === "cerebras" ? <span className="rounded-full bg-red-400 px-3 py-2 font-bold text-red-950">no API key — heuristic fallback</span> : null}
            </div>
          </div>

          <aside className="rounded-[2rem] border border-white/10 bg-slate-950/75 p-5 shadow-xl shadow-slate-950/30 backdrop-blur">
            <div className="grid grid-cols-3 gap-3">
              <button className="rounded-2xl bg-cyan-300 px-4 py-3 font-black text-cyan-950 shadow-lg shadow-cyan-950/30 transition hover:scale-[1.02] hover:bg-cyan-200" onClick={() => setRunning((value) => !value)}>{running ? "Pause" : "Start"}</button>
              <button className="rounded-2xl bg-white/10 px-4 py-3 font-bold transition hover:bg-white/15" onClick={() => void tick()}>Step</button>
              <button className="rounded-2xl bg-white/10 px-4 py-3 font-bold transition hover:bg-white/15" onClick={() => { setRunning(false); void reset(); }}>Reset</button>
            </div>
            {error ? <div className="mt-3 rounded-2xl border border-red-400/40 bg-red-400/10 px-4 py-3 text-sm text-red-100">{error}</div> : null}

            <div className="mt-6 space-y-5">
              <label className="block">
                <div className="mb-2 flex justify-between text-sm"><span>Agents</span><b>{agentCount}</b></div>
                <input className="w-full accent-cyan-300" type="range" min="10" max="60" value={agentCount} onChange={(event) => setAgentCount(Number(event.target.value))} onPointerUp={() => reset(backend, agentCount)} onKeyUp={() => reset(backend, agentCount)} />
              </label>
              <label className="block">
                <div className="mb-2 flex justify-between text-sm"><span>Tick interval</span><b>{tickInterval}ms</b></div>
                <input className="w-full accent-cyan-300" type="range" min="150" max="2000" step="50" value={tickInterval} onChange={(event) => setTickInterval(Number(event.target.value))} />
              </label>
              <label className="block">
                <div className="mb-2 flex justify-between text-sm"><span>Max concurrency</span><b>{maxConcurrency}</b></div>
                <input className="w-full accent-cyan-300" type="range" min="1" max="60" value={maxConcurrency} onChange={(event) => setMaxConcurrency(Number(event.target.value))} />
              </label>
            </div>

            <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-3">
              <div className="mb-3 text-xs font-bold uppercase tracking-[0.25em] text-slate-400">Backend</div>
              <div className="grid gap-2">
                {(["heuristic", "cerebras", "baseline"] as Backend[]).map((option) => (
                  <button key={option} disabled={option === "baseline" && baselineDisabled} className={classNames("rounded-2xl px-4 py-3 text-left font-bold transition", backend === option ? "bg-cyan-300 text-cyan-950" : "bg-white/10 hover:bg-white/15", option === "baseline" && baselineDisabled && "cursor-not-allowed opacity-45")} onClick={() => { setBackend(option); void reset(option, agentCount); }}>
                    {option === "heuristic" ? "Heuristic floor" : option === "cerebras" ? "Cerebras" : "Baseline GPU"}
                  </button>
                ))}
              </div>
              {world?.baselineReady === false ? <p className="mt-3 text-xs text-amber-200">TODO(human): set BASELINE_* to enable live comparison.</p> : null}
            </div>

            <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-4">
              <div className="mb-3 flex items-center justify-between text-sm"><span>Tick sparkline</span><b>{world?.thinkingAgents ?? 0}/{world?.agents.length ?? 0} LLM</b></div>
              <div className="flex h-20 items-end gap-1">
                {(world?.tickHistory ?? []).map((value, index) => <div key={`${index}-${value}`} className="flex-1 rounded-t bg-cyan-300" style={{ height: `${Math.min(100, Math.max(8, value / 20))}%` }} />)}
              </div>
            </div>

            <div className="mt-6 space-y-2 text-sm text-slate-300">
              <div className="font-bold text-slate-100">Event log</div>
              {(world?.events ?? []).slice(-6).reverse().map((event, index) => <div key={`${event.tick}-${index}`} className="rounded-xl bg-white/5 px-3 py-2">#{event.tick} {event.message}</div>)}
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
