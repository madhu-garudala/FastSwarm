import OpenAI from "openai";
import type { Agent, Backend, Decision, LocalView } from "./types";
import { decisionSchema } from "./types";
import { heuristicDecision } from "./world";

const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 2500);
const loggedModelErrors = new Set<string>();

const SYSTEM_PROMPT = "You are a tiny grid creature. Return JSON only. Survive, gather food, trade surplus with adjacent agents, claim rich safe cells, or rest. Choose one action and one direction.";

function clientForBackend(backend: Backend) {
  if (backend === "cerebras") {
    if (!process.env.CEREBRAS_API_KEY) return null;
    return { model: "gemma-4-31b", client: new OpenAI({ baseURL: "https://api.cerebras.ai/v1", apiKey: process.env.CEREBRAS_API_KEY, maxRetries: 0 }) };
  }
  if (backend === "baseline") {
    if (!process.env.BASELINE_API_KEY || !process.env.BASELINE_BASE_URL || !process.env.BASELINE_MODEL) return null;
    return { model: process.env.BASELINE_MODEL, client: new OpenAI({ baseURL: process.env.BASELINE_BASE_URL, apiKey: process.env.BASELINE_API_KEY, maxRetries: 0 }) };
  }
  return null;
}

function safeJson(content: string | null | undefined) {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  }
}

export async function callModelDecision(backend: Backend, view: LocalView): Promise<Decision | null> {
  const config = clientForBackend(backend);
  if (!config) return null;
  const completion = await config.client.chat.completions.create({
    model: config.model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Return JSON matching {"action":"move|gather|trade|claim|rest","dir":"N|S|E|W|NONE","note":"eight words max"}. Local view: ${JSON.stringify(view)}` },
    ],
    temperature: 0.4,
    max_completion_tokens: 80,
    response_format: { type: "json_object" },
  }, { timeout: LLM_TIMEOUT_MS });
  const parsed = decisionSchema.safeParse(safeJson(completion.choices[0]?.message?.content));
  if (!parsed.success) return null;
  return { ...parsed.data, note: parsed.data.note.split(/\s+/).slice(0, 8).join(" "), source: "llm" };
}

export async function decideAgent(agent: Agent, view: LocalView, backend: Backend, useLlm = true): Promise<Decision> {
  if (useLlm && backend !== "heuristic") {
    try {
      const llm = await callModelDecision(backend, view);
      if (llm) return llm;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const key = `${backend}:${message}`;
      if (!loggedModelErrors.has(key)) {
        loggedModelErrors.add(key);
        console.warn(`${backend} model fallback active: ${message}`);
      }
    }
  }
  return heuristicDecision(agent, view);
}

export async function decideTest() {
  const view: LocalView = {
    you: { energy: 7, inventory: 2, faction: 1, note: "heading north" },
    nearby_cells: [
      { dx: 0, dy: 0, food: 0, owner: 1 },
      { dx: 1, dy: 0, food: 5, owner: 2 },
      { dx: 0, dy: -1, food: 2, owner: null },
    ],
    nearby_agents: [{ dx: 1, dy: 0, faction: 2, inventory: 4 }],
  };
  const llm = await callModelDecision("cerebras", view);
  return llm ?? heuristicDecision({ id: 0, x: 0, y: 0, alive: true, energy: 7, inventory: 2, faction: 1, memoryNote: "heading north" }, view);
}
