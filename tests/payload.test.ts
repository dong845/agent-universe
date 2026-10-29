import { describe, expect, it } from "vitest";
import { worldScenario } from "../packages/mock/src/world.ts";
import { buildLedger } from "../packages/schema/src/aggregate.ts";
import type { AgentTownEvent } from "../packages/schema/src/event.ts";
import { BUILDINGS } from "../packages/schema/src/world.ts";
import { compactPayload } from "../packages/server/src/payload.ts";

const full = worldScenario();
const END = Math.max(...full.map((e) => e.ts)) + 1;
const NOW = END + 3_600_000;
const stale = new Map(full.map((e) => [e.raw.file, NOW - 7_200_000]));

describe("compactPayload", () => {
  const p = compactPayload(full, stale, NOW);
  const a = buildLedger(full);
  const b = buildLedger(p.events, p.buildingRows);

  it("keeps every token total of the full events, at every level", () => {
    const ks = a.tokenKeys();
    expect(ks.length).toBeGreaterThan(20);
    for (const k of ks) expect(b.tokensAt(k, END), k).toEqual(a.tokensAt(k, END));
    expect(b.tokenKeys().sort()).toEqual([...ks].sort());
  });

  it("keeps every building's calls, time and attributed input", () => {
    const bkeys = [...new Set(full.filter((e) => e.kind === "tool_end").map((e) => `${e.faction}|${e.projectId}`))];
    expect(bkeys.length).toBeGreaterThan(0);
    for (const d of bkeys)
      for (const { id } of BUILDINGS) {
        const k = `building:${d}:${id}`;
        expect(b.buildingAt(k, END), k).toEqual(a.buildingAt(k, END));
      }
  });

  it("is small: at most a start, an end and one call per agent for each finished task", () => {
    const tasks = new Set(full.filter((e) => e.taskId).map((e) => e.taskId));
    const agents = new Set(full.filter((e) => e.taskId).map((e) => `${e.taskId}|${e.agentId}`));
    expect(p.events.length).toBeLessThanOrEqual(2 * tasks.size + agents.size + 24 * 4);
    expect(p.liveTaskIds).toEqual([]);
    expect(p.source).toBe("real");
  });

  it("keeps titles on task starts", () => {
    const titled = full.filter((e) => e.kind === "task_start" && e.title).length;
    expect(p.events.filter((e) => e.kind === "task_start" && e.title).length).toBe(titled);
  });
});

describe("live tasks", () => {
  const ev = (taskId: string, file: string, ts: number, kind: AgentTownEvent["kind"], extra: Partial<AgentTownEvent> = {}): AgentTownEvent => ({
    id: `${taskId}-${kind}-${ts}`, ts, faction: "codex", projectId: "/p", sessionId: taskId, taskId, agentId: "main", kind, raw: { file, line: 1 }, ...extra,
  });
  const NOW2 = 10_000_000;
  const tasks: AgentTownEvent[] = [];
  const mt = new Map<string, number>();
  for (let i = 0; i < 8; i++) {
    tasks.push(ev(`L${i}`, `f${i}`, NOW2 - 600_000 + i * 1000, "task_start"), ev(`L${i}`, `f${i}`, NOW2 - 300_000 + i * 1000, "tool_start", { tool: "Read", toolUseId: `u${i}` }));
    mt.set(`f${i}`, NOW2 - 60_000);
  }
  tasks.push(ev("OLD", "fo", 1000, "task_start"), ev("OLD", "fo", 2000, "model_call", { tokens: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } }));
  mt.set("fo", NOW2 - 11 * 60_000);
  tasks.push(ev("DONE", "f0", NOW2 - 5000, "task_start"), ev("DONE", "f0", NOW2 - 4000, "task_end"));

  it("animates at most 6 unfinished tasks written in the last 10 minutes, the most recently active first", () => {
    const p = compactPayload(tasks, mt, NOW2);
    expect(p.liveTaskIds).toEqual(["L7", "L6", "L5", "L4", "L3", "L2"]);
    // live tasks keep every event, including tool calls
    expect(p.events.filter((e) => e.taskId === "L7" && e.kind === "tool_start")).toHaveLength(1);
    // the rest are summarised: no tool calls
    expect(p.events.filter((e) => e.taskId === "L0" && e.kind === "tool_start")).toHaveLength(0);
  });

  it("does not call a stale task without an end live, and gives it no invented end", () => {
    const p = compactPayload(tasks, mt, NOW2);
    expect(p.liveTaskIds).not.toContain("OLD");
    expect(p.events.filter((e) => e.taskId === "OLD").map((e) => e.kind).sort()).toEqual(["model_call", "task_start"]);
  });
});

describe("compactPayload requests and towns (v3)", () => {
  const p = compactPayload(full, stale, NOW);
  const sum = (ts: { input: number; output: number; cacheRead: number; cacheWrite: number }[]) => ts.reduce((a, t) => a + t.input + t.output + t.cacheRead + t.cacheWrite, 0);

  it("has one request per human-opened turn", () => {
    const humans = full.filter((e) => e.kind === "task_start" && e.trigger !== "system").length;
    expect(p.requests.length).toBe(humans);
    expect(humans).toBeGreaterThan(0);
  });

  it("request tokens add up to every model call inside a task", () => {
    expect(sum(p.requests.map((r) => r.tokens))).toBe(sum(full.filter((e) => e.kind === "model_call" && e.taskId && e.tokens).map((e) => e.tokens!)));
  });

  it("has exactly one town per faction and folder that holds a request", () => {
    expect(p.towns.map((t) => t.key).sort()).toEqual([...new Set(p.requests.map((r) => `${r.faction}|${r.projectId}`))].sort());
  });
});

import { demoPayload } from "../packages/mock/src/world.ts";

describe("demo payload (v3)", () => {
  it("carries requests and towns built the same way", () => {
    const d = demoPayload();
    expect(d.requests.length).toBeGreaterThan(0);
    expect(d.towns.length).toBeGreaterThan(0);
    expect(d.towns.every((t) => typeof t.theme === "string" && t.theme.length > 0)).toBe(true);
  });
});
