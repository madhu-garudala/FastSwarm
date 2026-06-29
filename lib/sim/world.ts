import type { Agent, Backend, Cell, Decision, Direction, EventLog, LocalView, TickOptions, TradeLink, World } from "./types";

const WIDTH = 24;
const HEIGHT = 24;
const FACTIONS = 6;
const DEFAULT_AGENTS = Number(process.env.AGENT_COUNT ?? 40);
const DEFAULT_CONCURRENCY = Number(process.env.MAX_CONCURRENCY ?? 16);
const dirDelta: Record<Direction, { dx: number; dy: number }> = {
  N: { dx: 0, dy: -1 },
  S: { dx: 0, dy: 1 },
  E: { dx: 1, dy: 0 },
  W: { dx: -1, dy: 0 },
  NONE: { dx: 0, dy: 0 },
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
function index(width: number, x: number, y: number) {
  return y * width + x;
}
function cellAt(world: World, x: number, y: number) {
  return world.grid[index(world.width, x, y)];
}
function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
function seededFood(x: number, y: number) {
  const wave = Math.sin(x * 0.7) + Math.cos(y * 0.53) + Math.sin((x + y) * 0.31);
  const pocket = (x - 5) ** 2 + (y - 6) ** 2 < 30 || (x - 18) ** 2 + (y - 16) ** 2 < 42;
  return clamp(Math.round((wave + 2.2) * 1.4 + (pocket ? 3 : 0)), 0, 9);
}

export function createWorld(agentCount = DEFAULT_AGENTS, backend: Backend = "heuristic"): World {
  const grid: Cell[] = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) grid.push({ x, y, food: seededFood(x, y), owner: null });
  }
  const agents: Agent[] = Array.from({ length: clamp(agentCount, 10, 60) }, (_, id) => ({
    id,
    x: (id * 7 + 3) % WIDTH,
    y: (id * 11 + 5) % HEIGHT,
    alive: true,
    energy: 8 + (id % 5),
    inventory: id % 3,
    faction: id % FACTIONS,
    memoryNote: "find food",
  }));
  return {
    width: WIDTH,
    height: HEIGHT,
    grid,
    agents,
    tickIndex: 0,
    lastTickMs: 0,
    backend,
    thinkingAgents: 0,
    heuristicAgents: agents.length,
    avgTickMs: 0,
    tickHistory: [],
    tradeLinks: [],
    events: [],
    noKey: !process.env.CEREBRAS_API_KEY,
    baselineReady: Boolean(process.env.BASELINE_API_KEY && process.env.BASELINE_BASE_URL && process.env.BASELINE_MODEL),
  };
}

export function localView(world: World, agent: Agent): LocalView {
  const nearby_cells = [];
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const x = agent.x + dx;
      const y = agent.y + dy;
      if (x >= 0 && y >= 0 && x < world.width && y < world.height) {
        const cell = cellAt(world, x, y);
        nearby_cells.push({ dx, dy, food: cell.food, owner: cell.owner });
      }
    }
  }
  const nearby_agents = world.agents
    .filter((other) => other.alive && other.id !== agent.id && Math.abs(other.x - agent.x) <= 2 && Math.abs(other.y - agent.y) <= 2)
    .slice(0, 8)
    .map((other) => ({ dx: other.x - agent.x, dy: other.y - agent.y, faction: other.faction, inventory: other.inventory }));
  return { you: { energy: agent.energy, inventory: agent.inventory, faction: agent.faction, note: agent.memoryNote }, nearby_cells, nearby_agents };
}

export function heuristicDecision(agent: Agent, view: LocalView): Decision {
  const current = view.nearby_cells.find((cell) => cell.dx === 0 && cell.dy === 0);
  const adjacentNeedyTrade = view.nearby_agents.some((other) => Math.abs(other.dx) + Math.abs(other.dy) === 1 && agent.inventory > 1 && other.inventory < 2);
  if (current && current.food > 0 && agent.energy <= 6) return { action: "gather", dir: "NONE", note: "urgent food", source: "heuristic" };
  if (adjacentNeedyTrade) return { action: "trade", dir: "NONE", note: "share surplus", source: "heuristic" };
  const target = [...view.nearby_cells]
    .filter((cell) => cell.dx !== 0 || cell.dy !== 0)
    .sort((a, b) => b.food - a.food || Math.abs(a.dx) + Math.abs(a.dy) - (Math.abs(b.dx) + Math.abs(b.dy)))[0];
  if (target && target.food >= Math.max(1, current?.food ?? 0)) {
    const dir = Math.abs(target.dx) > Math.abs(target.dy) ? (target.dx > 0 ? "E" : "W") : target.dy > 0 ? "S" : target.dy < 0 ? "N" : "NONE";
    if (dir !== "NONE") return { action: "move", dir, note: "flow to food", source: "heuristic" };
  }
  if (current && current.food > 0 && agent.inventory < 5) return { action: "gather", dir: "NONE", note: "eating here", source: "heuristic" };
  if (current && current.food >= 2 && current.owner !== agent.faction && agent.energy > 4) return { action: "claim", dir: "NONE", note: "hold ground", source: "heuristic" };
  return { action: agent.energy < 5 ? "rest" : "move", dir: agent.id % 4 === 0 ? "N" : agent.id % 4 === 1 ? "E" : agent.id % 4 === 2 ? "S" : "W", note: "scout edges", source: "heuristic" };
}

function cloneWorld(world: World): World {
  return { ...world, grid: world.grid.map((cell) => ({ ...cell })), agents: world.agents.map((agent) => ({ ...agent })), tradeLinks: [], events: [...world.events].slice(-8) };
}

export function applyDecisions(world: World, living: Agent[], decisions: Decision[], elapsedMs: number, backend: Backend): World {
  const next = cloneWorld(world);
  const occupied = new Map<string, number>();
  next.agents.forEach((agent) => { if (agent.alive) occupied.set(`${agent.x},${agent.y}`, agent.id); });
  const events: EventLog[] = [];

  for (const agent of next.agents) {
    if (!agent.alive) continue;
    agent.energy = clamp(agent.energy - 1, 0, 14);
    if (agent.energy <= 0 && agent.inventory > 0) {
      agent.inventory -= 1;
      agent.energy = 5;
    }
  }

  living.forEach((previous, offset) => {
    const agent = next.agents[previous.id];
    if (!agent?.alive) return;
    const decision = decisions[offset] ?? { action: "rest", dir: "NONE", note: "wait", source: "noop" };
    agent.memoryNote = decision.note.slice(0, 48);
    const cell = cellAt(next, agent.x, agent.y);

    if (decision.action === "gather" && cell.food > 0) {
      const amount = Math.min(2, cell.food);
      cell.food -= amount;
      agent.energy = clamp(agent.energy + amount * 2, 0, 14);
      agent.inventory = clamp(agent.inventory + Math.max(0, amount - 1), 0, 9);
    } else if (decision.action === "claim" && agent.energy > 2) {
      cell.owner = agent.faction;
      agent.energy -= 1;
      if (events.length < 4) events.push({ tick: world.tickIndex + 1, message: `faction ${agent.faction + 1} claimed ${agent.x},${agent.y}` });
    } else if (decision.action === "move") {
      const delta = dirDelta[decision.dir];
      const x = clamp(agent.x + delta.dx, 0, next.width - 1);
      const y = clamp(agent.y + delta.dy, 0, next.height - 1);
      const key = `${x},${y}`;
      if (!occupied.has(key)) {
        occupied.delete(`${agent.x},${agent.y}`);
        agent.x = x;
        agent.y = y;
        occupied.set(key, agent.id);
      }
    } else if (decision.action === "rest") {
      agent.energy = clamp(agent.energy + 1, 0, 14);
    }
  });

  const traders = living.map((agent, offset) => ({ id: agent.id, decision: decisions[offset] })).filter((item) => item.decision?.action === "trade");
  for (const trader of traders) {
    const a = next.agents[trader.id];
    const b = next.agents.find((candidate) => candidate.alive && candidate.id !== a.id && distance(a, candidate) === 1 && candidate.inventory < a.inventory);
    if (a && b && a.inventory > 1) {
      a.inventory -= 1;
      b.inventory += 1;
      b.energy = clamp(b.energy + 1, 0, 14);
      next.tradeLinks.push({ from: a.id, to: b.id, x1: a.x, y1: a.y, x2: b.x, y2: b.y, ttl: 1 });
      if (events.length < 4) events.push({ tick: world.tickIndex + 1, message: `agent ${a.id} traded with ${b.id}` });
    }
  }

  for (const agent of next.agents) {
    if (agent.energy <= 0) agent.alive = false;
  }
  for (const cell of next.grid) {
    const regrow = cell.owner === null ? 0.08 : 0.045;
    if (cell.food < 9 && Math.random() < regrow) cell.food += 1;
  }

  const history = [...world.tickHistory, elapsedMs].slice(-50);
  next.tickIndex = world.tickIndex + 1;
  next.lastTickMs = Math.round(elapsedMs);
  next.avgTickMs = Math.round(history.reduce((sum, value) => sum + value, 0) / history.length);
  next.tickHistory = history.map(Math.round);
  next.backend = backend;
  next.events = [...world.events, ...events].slice(-10);
  next.noKey = !process.env.CEREBRAS_API_KEY;
  next.baselineReady = Boolean(process.env.BASELINE_API_KEY && process.env.BASELINE_BASE_URL && process.env.BASELINE_MODEL);
  return next;
}

export async function runTick(world: World, decide: (agent: Agent, view: LocalView) => Promise<Decision>, options: TickOptions = {}) {
  const backend = options.backend ?? world.backend;
  const t0 = performance.now();
  const living = world.agents.filter((agent) => agent.alive);
  const concurrency = clamp(options.maxConcurrency ?? DEFAULT_CONCURRENCY, 1, 60);
  const decisions: Decision[] = new Array(living.length);
  let cursor = 0;
  async function worker() {
    while (cursor < living.length) {
      const current = cursor;
      cursor += 1;
      const agent = living[current];
      try {
        decisions[current] = await decide(agent, localView(world, agent));
      } catch {
        decisions[current] = heuristicDecision(agent, localView(world, agent));
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, living.length) }, worker));
  const elapsed = performance.now() - t0;
  const next = applyDecisions(world, living, decisions, elapsed, backend);
  next.thinkingAgents = decisions.filter((decision) => decision.source === "llm").length;
  next.heuristicAgents = decisions.filter((decision) => decision.source !== "llm").length;
  return next;
}
