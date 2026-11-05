// The review poster (spec 2026-11-05 C3): its numbers, and that it never draws a title, gist or path.
import { describe, expect, it } from "vitest";
import type { AgentTownEvent } from "../packages/schema/src/event.ts";
import type { RequestRow } from "../packages/schema/src/payload.ts";
import { drawPoster } from "../packages/web/src/share/poster.ts";
import { reviewStats } from "../packages/web/src/share/review.ts";

const TZ = "Europe/Amsterdam";
const at = (d: string, h = 12) => Date.parse(`${d}T${String(h).padStart(2, "0")}:00:00+01:00`);
const NOW = at("2026-11-05", 18);
let n = 0;
const req = (end: number, extra: Partial<RequestRow> = {}): RequestRow => ({
  requestId: `r${n++}`, faction: "claude-code", projectId: "/p/alpha", sessionId: "s", startTs: end - 60_000, endTs: end, ok: true,
  class: "produced", productKind: "code", tokens: { input: 10, output: 20, cacheRead: 100, cacheWrite: 5 }, calls: 3, fails: 0, spawns: 0,
  skills: [], topDir: null, turns: 1, taskIds: [`t${n}`], work: { smith: 2, scout: 1, spawn: 1 }, ...extra,
});
const requests = [
  req(at("2026-11-05")), req(at("2026-11-04")), req(at("2026-11-04"), { projectId: "/p/beta", class: "chat", tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }),
  req(at("2026-11-03"), { projectId: "/p/beta" }), req(at("2026-11-01"), { projectId: "/p/beta" }),
  req(at("2026-10-20")), req(at("2025-12-01")),
];
const spawn = (ts: number, agentType: string): AgentTownEvent => ({ id: `e${n++}`, ts, faction: "claude-code", projectId: "/p/alpha", sessionId: "s", taskId: "t", agentId: `a${n}`, kind: "agent_spawn", agentType, raw: { file: "", line: 0 } });

describe("reviewStats", () => {
  it("the last 7 days: counts, products, tokens, a day per cell", () => {
    const s = reviewStats(requests, "week", NOW, { tz: TZ });
    expect(s.days.map((d) => d.day)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]);
    expect(s.days.map((d) => d.n)).toEqual([0, 0, 1, 0, 1, 2, 1]);
    expect(s.requests).toBe(5);
    expect(s.products).toBe(4);
    expect(s.tokens).toBe(4 * 135 + 2);
  });
  it("a streak counts back from today (or yesterday) over active days", () => {
    expect(reviewStats(requests, "week", NOW, { tz: TZ }).streak).toBe(3);
    // nothing yet today: the streak still stands from yesterday
    expect(reviewStats(requests.slice(1), "week", NOW, { tz: TZ }).streak).toBe(2);
    expect(reviewStats([], "week", NOW, { tz: TZ }).streak).toBe(0);
  });
  it("the busiest project; ties go to the one with more tokens", () => {
    expect(reviewStats(requests, "week", NOW, { tz: TZ }).busiest).toEqual({ key: "claude-code|/p/beta", n: 3 });
    expect(reviewStats(requests.slice(0, 2).concat(requests.slice(3, 5)), "week", NOW, { tz: TZ }).busiest?.key).toBe("claude-code|/p/alpha");
  });
  it("kinds of work (no spawns), and subagent types from the events", () => {
    const s = reviewStats(requests, "week", NOW, { tz: TZ, events: [spawn(at("2026-11-04"), "Explore"), spawn(at("2026-11-04"), "Explore"), spawn(at("2026-11-02"), "Plan"), spawn(at("2026-01-01"), "old")] });
    expect(s.work[0]).toEqual({ role: "smith", n: 10 });
    expect(s.work.map((w) => w.role)).not.toContain("spawn");
    expect(s.subagents).toEqual([{ type: "Explore", n: 2 }, { type: "Plan", n: 1 }]);
  });
  it("subagents sent, from the requests' own counts (types need the events)", () => {
    expect(reviewStats(requests.map((r, i) => ({ ...r, spawns: i })), "week", NOW, { tz: TZ }).spawns).toBe(0 + 1 + 2 + 3 + 4);
  });
  it("longer periods and all time", () => {
    expect(reviewStats(requests, "month", NOW, { tz: TZ }).requests).toBe(6);
    expect(reviewStats(requests, "year", NOW, { tz: TZ }).requests).toBe(7);
    const all = reviewStats(requests, "all", NOW, { tz: TZ });
    expect(all.requests).toBe(7);
    expect(all.days[0].day).toBe("2025-12-01");
  });
  it("an empty period: zeros, no busiest project", () => {
    const s = reviewStats([], "week", NOW, { tz: TZ });
    expect([s.requests, s.products, s.tokens, s.streak]).toEqual([0, 0, 0, 0]);
    expect(s.busiest).toBeUndefined();
  });
});

describe("drawPoster", () => {
  const ctx = () => {
    const texts: string[] = [];
    const noop = () => undefined;
    const c = new Proxy({ fillText: (t: string) => texts.push(t), measureText: (t: string) => ({ width: t.length * 10 }), createLinearGradient: () => ({ addColorStop: noop }) } as Record<string, unknown>, {
      get: (o, k: string) => (k in o ? o[k] : noop),
      set: () => true,
    });
    return { c: c as unknown as CanvasRenderingContext2D, texts };
  };
  it("never draws a title, a gist, a path or a session id", () => {
    const secret = requests.map((r) => ({ ...r, title: "SECRET-TITLE", gist: { kind: "run" as const, command: "SECRET-CMD" }, cwd: "/Users/SECRET", sessionId: "SECRET-SESSION" }));
    const s = reviewStats(secret, "week", NOW, { tz: TZ });
    const { c, texts } = ctx();
    const drawn = drawPoster(c, s, { bg: null, face: null, lang: "zh", period: "week", names: (k) => `name:${k.split("/").pop()}` });
    expect(drawn).toEqual(texts);
    expect(drawn.join(" ")).not.toMatch(/SECRET|\/Users|\/p\//);
    expect(drawn.join(" ")).toContain("name:beta");
  });
  it("hidden names: the names function decides", () => {
    const { c } = ctx();
    const drawn = drawPoster(c, reviewStats(requests, "week", NOW, { tz: TZ }), { bg: null, face: null, lang: "en", period: "week", names: () => "Project 7" });
    expect(drawn.join(" ")).toContain("Project 7");
    expect(drawn.join(" ")).not.toContain("beta");
  });
});
