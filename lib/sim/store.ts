import type { Backend, TickOptions, World } from "./types";
import { decideAgent } from "./model";
import { createWorld, runTick } from "./world";

declare global {
  var fastSwarmWorld: World | undefined;
}

export function getWorld() {
  globalThis.fastSwarmWorld ??= createWorld();
  return globalThis.fastSwarmWorld;
}

export function resetWorld(agentCount?: number, backend?: Backend) {
  globalThis.fastSwarmWorld = createWorld(agentCount, backend ?? getWorld().backend);
  return globalThis.fastSwarmWorld;
}

export async function advanceWorld(options: TickOptions) {
  const current = getWorld();
  if (options.agentCount && options.agentCount !== current.agents.length) resetWorld(options.agentCount, options.backend ?? current.backend);
  const source = getWorld();
  const backend = options.backend ?? source.backend;
  const next = await runTick(source, (agent, view) => decideAgent(agent, view, backend, options.useLlm), options);
  globalThis.fastSwarmWorld = next;
  return next;
}
