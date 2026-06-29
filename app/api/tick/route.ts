import { NextResponse } from "next/server";
import { decideAgent } from "../../../lib/sim/model";
import { advanceWorld } from "../../../lib/sim/store";
import { tickRequestSchema, type World } from "../../../lib/sim/types";
import { runTick } from "../../../lib/sim/world";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function isWorld(value: unknown): value is World {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<World>;
  return (
    typeof candidate.width === "number" &&
    typeof candidate.height === "number" &&
    Array.isArray(candidate.grid) &&
    Array.isArray(candidate.agents) &&
    typeof candidate.tickIndex === "number"
  );
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = tickRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (isWorld(body.world)) {
    const backend = parsed.data.backend ?? body.world.backend;
    const world = await runTick(
      body.world,
      (agent, view) => decideAgent(agent, view, backend, parsed.data.useLlm),
      parsed.data,
    );
    return NextResponse.json(world);
  }

  const world = await advanceWorld(parsed.data);
  return NextResponse.json(world);
}
