import { z } from "zod";

export type Backend = "cerebras" | "baseline" | "heuristic";
export type Direction = "N" | "S" | "E" | "W" | "NONE";
export type Action = "move" | "gather" | "trade" | "claim" | "rest";

export type Cell = { x: number; y: number; food: number; owner: number | null };
export type Agent = {
  id: number;
  x: number;
  y: number;
  alive: boolean;
  energy: number;
  inventory: number;
  faction: number;
  memoryNote: string;
};
export type Decision = { action: Action; dir: Direction; note: string; source?: "llm" | "heuristic" | "noop" };
export type TradeLink = { from: number; to: number; x1: number; y1: number; x2: number; y2: number; ttl: number };
export type EventLog = { tick: number; message: string };
export type World = {
  width: number;
  height: number;
  grid: Cell[];
  agents: Agent[];
  tickIndex: number;
  lastTickMs: number;
  backend: Backend;
  thinkingAgents: number;
  heuristicAgents: number;
  avgTickMs: number;
  tickHistory: number[];
  tradeLinks: TradeLink[];
  events: EventLog[];
  noKey: boolean;
  baselineReady: boolean;
};
export type LocalView = {
  you: { energy: number; inventory: number; faction: number; note: string };
  nearby_cells: { dx: number; dy: number; food: number; owner: number | null }[];
  nearby_agents: { dx: number; dy: number; faction: number; inventory: number }[];
};
export type TickOptions = { backend?: Backend; agentCount?: number; maxConcurrency?: number; useLlm?: boolean };

export const decisionSchema = z.object({
  action: z.enum(["move", "gather", "trade", "claim", "rest"]),
  dir: z.enum(["N", "S", "E", "W", "NONE"]).default("NONE"),
  note: z.string().max(64).default("survive"),
});

export const tickRequestSchema = z.object({
  backend: z.enum(["cerebras", "baseline", "heuristic"]).optional(),
  agentCount: z.number().int().min(10).max(60).optional(),
  maxConcurrency: z.number().int().min(1).max(60).optional(),
  useLlm: z.boolean().optional(),
});
