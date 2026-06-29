import { NextResponse } from "next/server";
import { resetWorld } from "../../../lib/sim/store";
import { tickRequestSchema } from "../../../lib/sim/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 10;

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = tickRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  return NextResponse.json(resetWorld(parsed.data.agentCount, parsed.data.backend));
}
