import { describe, expect, it } from "vitest";
import { demoPayload } from "../packages/mock/src/world.ts";
import type { AgentTownEvent } from "../packages/schema/src/event.ts";
import { BUILDINGS } from "../packages/schema/src/world.ts";
import { activityOf, cityPlaces } from "../packages/web/src/city/cityData.ts";
import { compressGaps, MAX_GAP_MS } from "../packages/web/src/city/cityReplay.ts";
import { buildTimeline, sampleActor } from "../packages/web/src/orchestrator/timeline.ts";
import { LAYOUT_DEFAULTS, layoutTown } from "../packages/web/src/v3/townLayout.ts";

const p = demoPayload();
const town = [...p.towns].sort((a, b) => Object.keys(b.workCounts).length - Object.keys(a.workCounts).length)[0];
const layout = layoutTown(town, p.requests, LAYOUT_DEFAULTS);
const hall = layout.spots.find((s) => s.info.kind === "hall")!;

describe("a city's places", () => {
  const places = cityPlaces(layout);

  it("a kind of work with a building in town is done there; one without is done at the task hall", () => {
    for (const b of BUILDINGS) {
      const pub = layout.spots.find((s) => s.info.kind === "public" && s.info.work === b.role);
      expect(places.building(b.id), b.id).toEqual(pub ? { x: pub.x, z: pub.z } : { x: hall.x, z: hall.z });
    }
  });

  it("a figure works in front of its building, nearer the square, and figures side by side do not overlap", () => {
    for (const b of BUILDINGS) {
      const at = places.building(b.id);
      const d0 = places.door(b.id, 0);
      expect(Math.hypot(d0.x, d0.z)).toBeLessThan(Math.hypot(at.x, at.z));
      const d1 = places.door(b.id, 1), d2 = places.door(b.id, 2);
      expect(Math.hypot(d1.x - d0.x, d1.z - d0.z)).toBeGreaterThan(0.4);
      expect(Math.hypot(d2.x - d1.x, d2.z - d1.z)).toBeGreaterThan(0.4);
    }
  });

  it("a request's site is its own house when the town draws it", () => {
    const house = layout.spots.find((s) => s.info.kind === "house")!;
    const rid = (house.info as { requestId: string }).requestId;
    const own = cityPlaces(layout, rid);
    expect(Math.hypot(own.commanderPost.x - house.x, own.commanderPost.z - house.z)).toBeLessThan(1.5);
    for (let k = 0; k < 6; k++) {
      const s = own.scaffold(k);
      expect(Math.hypot(s.x - house.x, s.z - house.z)).toBeCloseTo(1.7, 6);
    }
  });

  it("a timeline built with a city's places sends the agent to that city's building for its tool", () => {
    const pub = layout.spots.find((s) => s.info.kind === "public")!;
    const role = (pub.info as { work: string }).work;
    const ev = (kind: AgentTownEvent["kind"], ts: number, extra: Partial<AgentTownEvent> = {}): AgentTownEvent =>
      ({ id: `${kind}${ts}`, ts, faction: town.faction, projectId: town.projectId, sessionId: "s", taskId: "t", agentId: "a", kind, raw: { file: "x", line: ts }, ...extra }) as AgentTownEvent;
    const tl = buildTimeline([ev("task_start", 0), ev("tool_start", 3000, { toolUseId: "u", role: role as AgentTownEvent["role"], tool: "X" }), ev("tool_end", 9000, { toolUseId: "u", status: "ok" }), ev("task_end", 12000, { status: "ok" })], cityPlaces(layout));
    const work = tl.actors[0].actions.find((a) => a.pose === "work")!;
    const door = cityPlaces(layout).door(work.building!, 0);
    expect(sampleActor(tl.actors[0], (work.start + work.end) / 2).pos).toEqual(door);
    expect(Math.hypot(door.x - pub.x, door.z - pub.z)).toBeLessThan(2.5);
  });
});

describe("what a robot says it is doing", () => {
  it("names the kind of work by its plain name, and the waiting and failing states", () => {
    expect(activityOf("work", "workshop", false)).toBe("跑命令");
    expect(activityOf("walk", "library", false)).toBe("去读代码");
    expect(activityOf("raise_hand", undefined, false)).toBe("等你回复");
    expect(activityOf("fall", "workshop", false)).toBe("出错了");
    expect(activityOf("shake", "workshop", false)).toBe("被拒绝");
    expect(activityOf("pack", undefined, false)).toBe("压缩记忆");
    expect(activityOf("idle", undefined, true)).toBe("思考");
  });
});

describe("a replay's quiet gaps", () => {
  const e = (ts: number) => ({ id: String(ts), ts }) as AgentTownEvent;
  it("shortens every gap longer than the limit to the limit, keeps the order and the short gaps", () => {
    const { events, cut } = compressGaps([e(0), e(1000), e(61_000), e(62_000), e(3_662_000)]);
    expect(events.map((x) => x.ts)).toEqual([0, 1000, 1000 + MAX_GAP_MS, 2000 + MAX_GAP_MS, 2000 + 2 * MAX_GAP_MS]);
    expect(cut).toBe(60_000 - MAX_GAP_MS + 3_600_000 - MAX_GAP_MS);
  });
  it("sorts first, leaves a busy stretch alone, and copes with no events", () => {
    expect(compressGaps([e(2000), e(0), e(1000)]).events.map((x) => x.ts)).toEqual([0, 1000, 2000]);
    expect(compressGaps([e(0), e(10)]).cut).toBe(0);
    expect(compressGaps([])).toEqual({ events: [], cut: 0 });
  });
});
