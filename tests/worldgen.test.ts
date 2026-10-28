import { describe, expect, it } from "vitest";
import { MOCK_PROJECTS, worldScenario } from "../packages/mock/src/world.ts";
import { DEMO } from "../packages/mock/src/scenario.ts";
import { BRIDGE_WINDOW_MS, HOUSE_RING, HOUSES_PER_TIER, TIER_TOKENS, buildWorld, houseSlot, riverX, tierOf } from "../packages/web/src/orchestrator/worldgen.ts";
import type { AgentTownEvent } from "../packages/schema/src/event.ts";
import { HALL, HALL_BUILDING, SENTRY_BOOTH, WAREHOUSE } from "../packages/web/src/orchestrator/layout.ts";

const events = worldScenario();
const world = buildWorld(events);
const d = (faction: string, p: string) => world.districts.find((x) => x.faction === faction && x.projectId === p)!;

describe("world layout", () => {
  it("has one district per (faction, project)", () => {
    expect(world.districts).toHaveLength(MOCK_PROJECTS.length);
  });

  it("keeps each faction on its own bank of the river", () => {
    for (const x of world.districts) {
      if (x.faction === "codex") expect(x.origin.x).toBeGreaterThan(15);
      else expect(x.origin.x).toBeLessThan(-15);
    }
  });

  it("never overlaps two districts", () => {
    for (const a of world.districts)
      for (const b of world.districts) {
        if (a === b) continue;
        expect(Math.hypot(a.origin.x - b.origin.x, a.origin.z - b.origin.z)).toBeGreaterThan(a.radius + b.radius - 0.01);
      }
  });

  it("is the same world every time, and a district keeps its place when another project appears", () => {
    expect(buildWorld(worldScenario())).toEqual(world);
    const extra = [...events, { ...events[0], id: "new-project", projectId: "/demo/zz-new", taskId: null, kind: "task_start" as const }];
    const grown = buildWorld(extra);
    for (const x of world.districts) {
      if (x.projectId === "/demo/web-shop") continue; // shared rows are placed first by design
      const y = grown.districts.find((g) => g.key === x.key)!;
      // open addressing: a district moves only if the newcomer took its preferred slot first
      if (y.origin.x !== x.origin.x || y.origin.z !== x.origin.z) expect(grown.districts.some((g) => g.projectId === "/demo/zz-new")).toBe(true);
    }
  });

  it("puts a project worked on by both factions on the same row, facing across the river", () => {
    const a = d("claude-code", "/demo/web-shop");
    const b = d("codex", "/demo/web-shop");
    expect(a.origin.z).toBe(b.origin.z);
    // the column nearest the river
    expect(Math.abs(a.origin.x)).toBe(Math.min(...world.districts.filter((x) => x.faction === "claude-code").map((x) => Math.abs(x.origin.x))));
  });

  it("sizes districts by cumulative tokens on the plan's five tiers", () => {
    expect(tierOf(0)).toBe(1);
    expect(tierOf(TIER_TOKENS[1] - 1)).toBe(1);
    expect(tierOf(TIER_TOKENS[1])).toBe(2);
    expect(tierOf(1e12)).toBe(5);
    const sorted = [...world.districts].sort((a, b) => a.tokens - b.tokens);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].tier).toBeGreaterThanOrEqual(sorted[i - 1].tier);
  });

  it("builds one house per finished task, up to the tier's cap; a live task stays its site, not a house", () => {
    const live = new Set(events.filter((e) => e.kind === "tool_start").map((e) => e.taskId));
    for (const x of world.districts) {
      const finished = new Set(events.filter((e) => e.kind === "task_end" && e.faction === x.faction && e.projectId === x.projectId && !live.has(e.taskId)).map((e) => e.taskId));
      for (const h of x.houses) expect(live.has(h.taskId)).toBe(false);
      expect(x.houses.length + x.olderTasks).toBe(finished.size);
      expect(x.houses.length).toBeLessThanOrEqual(x.tier * HOUSES_PER_TIER);
    }
  });

  it("keeps houses off the district's front, where the hall, booth and warehouse stand", () => {
    for (let i = 0; i < 200; i++) {
      const p = houseSlot({ x: 0, z: 0 }, i, "claude-code");
      expect(Math.hypot(p.x, p.z)).toBeGreaterThanOrEqual(HOUSE_RING - 1e-9);
      for (const q of [HALL, HALL_BUILDING, SENTRY_BOOTH, WAREHOUSE]) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThan(2.5);
    }
  });

  it("records the live hand-over: Codex starts on web-shop 12 minutes after Claude finished", () => {
    expect(world.bridges).toHaveLength(1);
    const b = world.bridges[0];
    expect(b.districts).toEqual(["claude-code|/demo/web-shop", "codex|/demo/web-shop"]);
    expect(b.crossings).toContainEqual({ from: "claude-code|/demo/web-shop", to: "codex|/demo/web-shop", at: DEMO.t0 + 5000 });
    expect(b.at).toBe(b.crossings[0].at);
  });

  it("bridges inside the 30-minute window and not a millisecond past it", () => {
    const base = { projectId: "/p", sessionId: "s", agentId: "main", raw: { file: "x", line: 0 } };
    const at = (gap: number) => [
      { ...base, faction: "claude-code" as const, id: "a1", taskId: "A", ts: 0, kind: "task_start" as const },
      { ...base, faction: "claude-code" as const, id: "a2", taskId: "A", ts: 1000, kind: "task_end" as const },
      { ...base, faction: "codex" as const, id: "b1", taskId: "B", ts: 1000 + gap, kind: "task_start" as const },
    ];
    expect(buildWorld(at(BRIDGE_WINDOW_MS)).bridges).toHaveLength(1);
    expect(buildWorld(at(BRIDGE_WINDOW_MS + 1)).bridges).toHaveLength(0);
  });

  it("keeps the demo's districts inside the world, on their own bank, clear of the capitals", () => {
    inFrame(world);
  });
});

function inFrame(w: ReturnType<typeof buildWorld>) {
  for (const x of w.districts) {
    expect(x.origin.x - x.radius).toBeGreaterThan(w.bounds.minX);
    expect(x.origin.x + x.radius).toBeLessThan(w.bounds.maxX);
    expect(x.origin.z - x.radius).toBeGreaterThan(w.bounds.minZ + 26); // south of the mountain band
    expect(x.origin.z + x.radius).toBeLessThan(w.bounds.maxZ);
    const gap = x.faction === "codex" ? x.origin.x - x.radius - riverX(x.origin.z) : riverX(x.origin.z) - (x.origin.x + x.radius);
    expect(gap).toBeGreaterThan(4);
    for (const c of Object.values(w.capitals)) expect(Math.hypot(c.x - x.origin.x, c.z - x.origin.z)).toBeGreaterThan(x.radius + 6);
    for (const h of x.houses) expect(Math.hypot(h.at.x - x.origin.x, h.at.z - x.origin.z)).toBeLessThan(x.radius);
  }
  const zs = w.districts.map((x) => x.origin.z);
  expect(w.river[0].z).toBeLessThanOrEqual(Math.min(...zs) - 20);
  expect(w.river.at(-1)!.z).toBeGreaterThanOrEqual(Math.max(...zs) + 20);
}

describe("a world as big as real logs", () => {
  // 60 projects a side; every tenth has enough finished tasks to reach tier 5 and its house cap
  const big: AgentTownEvent[] = [];
  let n = 0;
  for (const faction of ["claude-code", "codex"] as const)
    for (let p = 0; p < 60; p++) {
      const tasks = p % 10 === 0 ? 120 : 3;
      for (let t = 0; t < tasks; t++) {
        const base = { faction, projectId: `/big/p${p}`, sessionId: `s${p}`, agentId: "main", taskId: `${faction}-${p}-${t}`, raw: { file: "x", line: 0 } };
        big.push({ ...base, id: `e${n++}`, ts: t * 10, kind: "task_start" });
        big.push({ ...base, id: `e${n++}`, ts: t * 10 + 1, kind: "model_call", tokens: { input: 0, output: 0, cacheRead: p % 10 === 0 ? 2e6 : 1e4, cacheWrite: 0 } });
        big.push({ ...base, id: `e${n++}`, ts: t * 10 + 2, kind: "task_end" });
      }
    }
  const w = buildWorld(big);

  it("places all 120 districts without overlap", () => {
    expect(w.districts).toHaveLength(120);
    expect(w.districts.filter((x) => x.tier === 5)).toHaveLength(12);
    for (const a of w.districts)
      for (const b of w.districts) {
        if (a === b) continue;
        expect(Math.hypot(a.origin.x - b.origin.x, a.origin.z - b.origin.z)).toBeGreaterThan(a.radius + b.radius);
      }
  });

  it("keeps every district inside the world, on its own bank, clear of the capitals and mountains", () => {
    inFrame(w);
  });
});

describe("tasks with no recorded end", () => {
  const base = { faction: "claude-code" as const, projectId: "/p", sessionId: "s", agentId: "main", raw: { file: "x", line: 0 } };
  const evs: AgentTownEvent[] = [
    { ...base, id: "a", taskId: "T", ts: 100, kind: "task_start" },
    { ...base, id: "b", taskId: "T", ts: 900, kind: "model_call", tokens: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } },
  ];

  it("become houses with no verdict, built at their last event", () => {
    const h = buildWorld(evs).districts[0].houses[0];
    expect(h.ok).toBeNull();
    expect(h.builtAt).toBe(900);
  });

  it("stay off the map as houses while live", () => {
    expect(buildWorld(evs, new Set(["T"])).districts[0].houses).toHaveLength(0);
  });
});
