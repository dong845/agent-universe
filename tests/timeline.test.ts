import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseClaudeSession } from "../packages/adapter-claude/src/index.ts";
import { demoScenario, DEMO } from "../packages/mock/src/scenario.ts";
import type { AgentTownEvent } from "../packages/schema/src/event.ts";
import { loadRoles } from "../packages/schema/src/roles.ts";
import { newStats } from "../packages/schema/src/util.ts";
import { buildingOf } from "../packages/schema/src/world.ts";
import { COMMANDER_POST, doorOf, HALL, SENTRY_POST } from "../packages/web/src/orchestrator/layout.ts";
import { MAX_LAG_MS, MAX_WALK_MS, buildTimeline, cubesFor, sampleActor, type Timeline } from "../packages/web/src/orchestrator/timeline.ts";

const near = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z) < 1e-6;

/** the invariants every timeline must keep, whatever the input */
function checkInvariants(events: AgentTownEvent[], tl: Timeline) {
  const ts = new Map(events.map((e) => [e.id, e.ts - tl.t0]));
  for (const a of tl.actors) {
    for (let i = 0; i < a.actions.length; i++) {
      const x = a.actions[i];
      expect(x.end).toBeGreaterThan(x.start);
      if (i) expect(x.start).toBeGreaterThanOrEqual(a.actions[i - 1].end - 1e-6); // one thing at a time
      if (x.pose === "walk" || x.pose === "carry" || x.pose === "report") expect(x.end - x.start).toBeLessThanOrEqual(MAX_WALK_MS + 1e-6);
      const et = ts.get(x.eventId);
      expect(et, `action for unknown event ${x.eventId}`).toBeDefined();
      // never animated before its event happened, never more than 3 s after it was due
      expect(x.due).toBeGreaterThanOrEqual(et! - 1e-6);
      expect(x.start - x.due).toBeLessThanOrEqual(MAX_LAG_MS + 1e-6);
    }
  }
}

describe("timeline of the demo", () => {
  const ev = demoScenario();
  const tl = buildTimeline(ev);
  const s = (sec: number) => DEMO.t0 + sec * 1000 - tl.t0;
  const actor = (id: string) => tl.actors.find((a) => a.id === id)!;

  it("keeps the walk, ordering and lag limits", () => checkInvariants(ev, tl));

  it("sends every tool call to the building of its role", () => {
    for (const e of ev.filter((x) => x.kind === "tool_start")) {
      const b = buildingOf(e.role);
      if (!b) continue;
      const work = actor(e.agentId).actions.find((a) => a.eventId === e.id && a.pose === "work");
      expect(work, `${e.tool} ${e.target}`).toBeDefined();
      expect(work!.building).toBe(b);
      expect(near(work!.to, doorOf(b, actor(e.agentId).lane))).toBe(true);
      expect(work!.outfit).toBe(e.role);
    }
  });

  it("shows the figure working at the library halfway through a Read", () => {
    // main Read src/http/client.ts runs 3.5 s → 3.9 s; the walk there takes under 1.5 s
    const work = actor("main").actions.find((a) => a.pose === "work" && a.building === "library")!;
    const at = sampleActor(actor("main"), (work.start + work.end) / 2);
    expect(at.pose).toBe("work");
    expect(at.outfit).toBe("scout");
    expect(near(at.pos, doorOf("library", 0))).toBe(true);
  });

  it("runs both subagents at the same time", () => {
    const t = s(9.3); // scout greps, tester reads, both at the library or on the way
    const a = sampleActor(actor("agent-scout"), t);
    const b = sampleActor(actor("agent-tests"), t);
    expect(a.visible && b.visible).toBe(true);
    expect(a.pose).not.toBe("idle");
    expect(b.pose).not.toBe("idle");
  });

  it("never puts two figures on the same spot while both work", () => {
    const works = tl.actors.flatMap((a) => a.actions.filter((x) => x.pose === "work").map((x) => ({ a: a.id, x })));
    for (const p of works)
      for (const q of works) {
        if (p.a === q.a || p.x.start >= q.x.end || q.x.start >= p.x.end) continue; // not at the same time
        expect(Math.hypot(p.x.to.x - q.x.to.x, p.x.to.z - q.x.to.z)).toBeGreaterThan(0.6);
      }
  });

  it("builds a floor per successful main edit and merges each scaffold on return", () => {
    expect(tl.floors.filter((f) => f.kind === "main")).toHaveLength(4); // 23.5, 29.5, 37.5, 38.0
    expect(tl.floors.filter((f) => f.kind === "subagent")).toHaveLength(2);
    expect(tl.scaffolds.find((x) => x.agentId === "agent-tests")!.floors).toHaveLength(1); // its Write
    for (const sc of tl.scaffolds) {
      const a = actor(sc.agentId);
      expect(sc.merge).not.toBeNull();
      expect(a.vanish).toBeGreaterThan(sc.merge!);
      expect(near(a.actions.at(-1)!.to, { x: COMMANDER_POST.x + 0.9, z: COMMANDER_POST.z + 0.9 })).toBe(true); // reported to the commander
    }
  });

  it("raises a hand at the hall during the permission wait", () => {
    const at = sampleActor(actor("main"), s(46.5)); // git commit waits 44.1 → ~49
    expect(at.pose).toBe("raise_hand");
    expect(near(at.pos, HALL)).toBe(true);
  });

  it("shakes its head at the denied command and falls at the tool error", () => {
    const main = actor("main");
    const denied = ev.find((e) => e.kind === "tool_end" && e.status === "denied")!;
    const failed = ev.find((e) => e.kind === "tool_end" && e.status === "error" && e.agentId === "main" && e.ts > DEMO.t0 + 50_000)!;
    expect(main.actions.some((a) => a.eventId === denied.id && a.pose === "shake")).toBe(true);
    expect(main.actions.some((a) => a.eventId === failed.id && a.pose === "fall")).toBe(true);
    expect(tl.buildingSmoke.some((b) => b.eventId === failed.id && b.building === "library")).toBe(true);
  });

  it("turns the backpack red before compaction and empties it after", () => {
    const main = actor("main");
    expect(sampleActor(main, s(34.6)).backpack).toBeCloseTo(170_000 / 200_000);
    expect(sampleActor(main, s(35.1)).backpack).toBeCloseTo(31_000 / 200_000);
  });

  it("roofs the site at task end and carries the rework spans over", () => {
    expect(tl.roofAt).toBe(s(55));
    expect(tl.clouds).toHaveLength(1);
    expect(tl.clouds[0].start).toBe(s(37.8));
  });

  it("caps cubes at 12 and uses log10", () => {
    expect(cubesFor(0)).toBe(0);
    expect(cubesFor(5)).toBe(1);
    expect(cubesFor(12_400)).toBe(4);
    expect(cubesFor(1e15)).toBe(12);
  });
});

describe("guardians", () => {
  it("stand at the sentry post, get no scaffold and build no floor", async () => {
    const { worldScenario } = await import("../packages/mock/src/world.ts");
    const ev = worldScenario().filter((e) => e.faction === "codex" && e.projectId === "/demo/web-shop" && e.ts >= DEMO.t0);
    const tl = buildTimeline(ev);
    const g = tl.actors.find((a) => a.agentType === "guardian")!;
    expect(g.baseRole).toBe("sentry");
    expect(near(g.home, SENTRY_POST)).toBe(true);
    expect(tl.scaffolds.some((x) => x.agentId === g.id)).toBe(false);
    expect(tl.floors.some((f) => f.agentId === g.id)).toBe(false);
    expect(g.vanish).not.toBeNull();
    checkInvariants(ev, tl);
  });
});

describe("timeline under load", () => {
  it("fast-forwards a burst instead of falling more than 3 s behind", () => {
    const base = { faction: "claude-code" as const, projectId: "p", sessionId: "s", taskId: "T", agentId: "main", raw: { file: "x", line: 0 } };
    const ev: AgentTownEvent[] = [{ ...base, id: "start", ts: 0, kind: "task_start" }];
    for (let i = 0; i < 60; i++) {
      const role = (["scout", "smith", "engineer", "inspector"] as const)[i % 4];
      ev.push({ ...base, id: `s${i}`, ts: 1000 + i * 20, kind: "tool_start", toolUseId: `u${i}`, role, target: `f${i % 3}` });
      ev.push({ ...base, id: `e${i}`, ts: 1010 + i * 20, kind: "tool_end", toolUseId: `u${i}`, status: i % 7 ? "ok" : "error" });
    }
    const tl = buildTimeline(ev);
    checkInvariants(ev, tl);
    expect(tl.fastForwards).toBeGreaterThan(0);
  });

  it("handles an empty event list", () => {
    const tl = buildTimeline([]);
    expect(tl.actors).toHaveLength(0);
    expect(tl.duration).toBe(0);
  });
});

// Real data: the scrubbed fixtures (git-ignored, so this skips on a fresh clone).
const FIX = join(import.meta.dirname, "../fixtures/claude-code");
const fixtureMains = existsSync(FIX)
  ? readdirSync(FIX).flatMap((d) => readdirSync(join(FIX, d)).filter((f) => f.endsWith(".jsonl")).map((f) => join(FIX, d, f)))
  : [];

describe.skipIf(!fixtureMains.length)("timeline of real sessions", () => {
  it("keeps every invariant on each real task", () => {
    const roles = loadRoles();
    let tasks = 0;
    for (const m of fixtureMains) {
      const { events } = parseClaudeSession(m, roles, newStats());
      const byTask = new Map<string, AgentTownEvent[]>();
      for (const e of events) if (e.taskId) byTask.set(e.taskId, [...(byTask.get(e.taskId) ?? []), e]);
      for (const evs of byTask.values()) {
        checkInvariants(evs, buildTimeline(evs));
        tasks++;
      }
    }
    expect(tasks).toBeGreaterThan(10);
  });
});
