"use client";

import { useEffect, useRef } from "react";
import type { World } from "../lib/sim/types";

const factionColors = ["#38bdf8", "#a78bfa", "#fb7185", "#facc15", "#34d399", "#f97316"];

type Props = { world: World | null; previous: World | null; tickInterval: number };

export function SwarmCanvas({ world, previous, tickInterval }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const worldRef = useRef(world);
  const prevRef = useRef(previous);
  const startRef = useRef(performance.now());

  useEffect(() => {
    prevRef.current = previous;
    worldRef.current = world;
    startRef.current = performance.now();
  }, [world, previous]);

  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const canvas = canvasRef.current;
      const snapshot = worldRef.current;
      if (!canvas || !snapshot) {
        frame = requestAnimationFrame(draw);
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.floor(rect.width * dpr) || canvas.height !== Math.floor(rect.height * dpr)) {
        canvas.width = Math.floor(rect.width * dpr);
        canvas.height = Math.floor(rect.height * dpr);
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      const padding = 18;
      const size = Math.min((rect.width - padding * 2) / snapshot.width, (rect.height - padding * 2) / snapshot.height);
      const ox = (rect.width - size * snapshot.width) / 2;
      const oy = (rect.height - size * snapshot.height) / 2;
      const bg = ctx.createRadialGradient(rect.width * 0.35, rect.height * 0.2, 20, rect.width * 0.5, rect.height * 0.5, rect.width * 0.75);
      bg.addColorStop(0, "rgba(8, 47, 73, 0.95)");
      bg.addColorStop(0.5, "rgba(15, 23, 42, 0.94)");
      bg.addColorStop(1, "rgba(2, 6, 23, 0.98)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, rect.width, rect.height);

      for (const cell of snapshot.grid) {
        const x = ox + cell.x * size;
        const y = oy + cell.y * size;
        const foodAlpha = Math.min(0.82, cell.food / 11);
        ctx.fillStyle = `rgba(34, 197, 94, ${foodAlpha})`;
        ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
        if (cell.food > 5) {
          ctx.fillStyle = `rgba(187, 247, 208, ${foodAlpha * 0.34})`;
          ctx.beginPath();
          ctx.arc(x + size / 2, y + size / 2, size * 0.45, 0, Math.PI * 2);
          ctx.fill();
        }
        if (cell.owner !== null) {
          ctx.fillStyle = `${factionColors[cell.owner % factionColors.length]}33`;
          ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
        }
      }

      ctx.strokeStyle = "rgba(148, 163, 184, 0.08)";
      ctx.lineWidth = 1;
      for (let x = 0; x <= snapshot.width; x += 1) {
        ctx.beginPath();
        ctx.moveTo(ox + x * size, oy);
        ctx.lineTo(ox + x * size, oy + snapshot.height * size);
        ctx.stroke();
      }
      for (let y = 0; y <= snapshot.height; y += 1) {
        ctx.beginPath();
        ctx.moveTo(ox, oy + y * size);
        ctx.lineTo(ox + snapshot.width * size, oy + y * size);
        ctx.stroke();
      }

      for (const link of snapshot.tradeLinks) {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.82)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(ox + (link.x1 + 0.5) * size, oy + (link.y1 + 0.5) * size);
        ctx.lineTo(ox + (link.x2 + 0.5) * size, oy + (link.y2 + 0.5) * size);
        ctx.stroke();
      }

      const prev = prevRef.current;
      const progress = Math.min(1, (performance.now() - startRef.current) / Math.max(120, tickInterval));
      const eased = 1 - Math.pow(1 - progress, 3);
      for (const agent of snapshot.agents) {
        if (!agent.alive) continue;
        const old = prev?.agents.find((candidate) => candidate.id === agent.id);
        const px = old ? old.x + (agent.x - old.x) * eased : agent.x;
        const py = old ? old.y + (agent.y - old.y) * eased : agent.y;
        const cx = ox + (px + 0.5) * size;
        const cy = oy + (py + 0.5) * size;
        ctx.shadowColor = factionColors[agent.faction % factionColors.length];
        ctx.shadowBlur = 12;
        ctx.fillStyle = factionColors[agent.faction % factionColors.length];
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(5, size * 0.34), 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(15, 23, 42, 0.86)";
        ctx.fillRect(cx - size * 0.18, cy - size * 0.06, size * 0.36 * (agent.energy / 14), 2);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [tickInterval]);

  return <canvas ref={canvasRef} className="h-full min-h-[520px] w-full rounded-[2rem] border border-white/10 bg-slate-950 shadow-2xl shadow-cyan-950/30" />;
}
