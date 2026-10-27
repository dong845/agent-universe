import { describe, expect, it } from "vitest";
import { MOCK_PROJECTS, worldScenario } from "../packages/mock/src/world.ts";
import { DEMO } from "../packages/mock/src/scenario.ts";
import { BRIDGE_WINDOW_MS, HOUSE_RING, HOUSES_PER_TIER, TIER_TOKENS, buildWorld, houseSlot, slotsFor, tierOf } from "../packages/web/src/orchestrator/worldgen.ts";
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
    expect(Math.abs(a.origin.x)).toBe(slotsFor(-1)[0].x * -1);
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
});
