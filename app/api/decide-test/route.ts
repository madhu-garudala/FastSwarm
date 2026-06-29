import { NextResponse } from "next/server";
import { decideTest } from "../../../lib/sim/model";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST() {
  if (!process.env.CEREBRAS_API_KEY) {
    return NextResponse.json({ skipped: true, todo: "TODO(human): set CEREBRAS_API_KEY to verify live gemma-4-31b structured JSON", decision: await decideTest() });
  }
  return NextResponse.json({ skipped: false, decision: await decideTest() });
}
