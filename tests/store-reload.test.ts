// A new world from the log watcher must not throw the owner out of what they are looking at
// (spec 2026-11-01 A1; plan Review Focus 1).
import { describe, expect, it } from "vitest";
import { demoPayload } from "../packages/mock/src/world.ts";
import { useStore } from "../packages/web/src/store.ts";

describe("store.reload", () => {
  it("keeps focus, city, selection and a scrubbed time; shows the new request", () => {
    const p1 = demoPayload();
    const s = useStore.getState();
    s.load(p1);
    const town = p1.towns[0].key;
    const req = p1.requests.find((r) => `${r.faction}|${r.projectId}` === town)!;
    useStore.getState().setFocus(town);
    useStore.getState().setCity(town);
    useStore.getState().select({ kind: "request", district: town, requestId: req.requestId });
    useStore.getState().setTime(useStore.getState().duration / 2);
    const t = useStore.getState().t;
    const extra = { ...req, requestId: "new-request-1", startTs: req.endTs + 1, endTs: req.endTs + 2 };
    useStore.getState().reload({ ...p1, requests: [...p1.requests, extra] });
    const st = useStore.getState();
    expect(st.focus).toBe(town);
    expect(st.city).toBe(town);
    expect(st.selected).toEqual({ kind: "request", district: town, requestId: req.requestId });
    expect(st.t).toBe(t);
    expect(st.w25?.requests.has("new-request-1")).toBe(true);
  });
  it("drops a selection whose request is gone, and follows 'now' when the clock was at the end", () => {
    const p1 = demoPayload();
    useStore.getState().load(p1);
    const town = p1.towns[0].key;
    useStore.getState().select({ kind: "request", district: town, requestId: "no-such-request" });
    useStore.getState().setTime(useStore.getState().duration);
    useStore.getState().reload(p1);
    expect(useStore.getState().selected).toBeNull();
    expect(useStore.getState().t).toBe(useStore.getState().duration);
  });
  it("attention list", () => {
    useStore.getState().setAttention([{ session: "claude-code|x", faction: "claude-code", sessionId: "x", projectId: "/p", requestId: null, state: "turn-done", since: 1, exact: false }]);
    expect(useStore.getState().attention).toHaveLength(1);
  });
});

describe("a shared world (no events)", () => {
  it("opens at the end of its record, so every finished product counts", async () => {
    const { sharePayload } = await import("../packages/schema/src/share.ts");
    const { makeShareIds } = await import("../packages/server/src/shareKeys.ts");
    const { absTime } = await import("../packages/web/src/store.ts");
    const p = sharePayload(demoPayload(), { ids: makeShareIds("t"), townNames: false, titles: false, replays: [] });
    useStore.getState().load(p);
    const st = useStore.getState();
    expect(st.playing).toBe(false);
    expect(absTime(st.t)).toBe(Math.max(...p.requests.map((r) => r.endTs)));
  });
});

describe("live: the clock follows the newest record (spec 2026-11-03 A3)", () => {
  const real = () => ({ ...demoPayload(), source: "real" as const });
  const later = (p: ReturnType<typeof real>, ms: number) => {
    const last = p.events[p.events.length - 1];
    return { ...p, events: [...p.events, { ...last, id: `later-${ms}`, ts: last.ts + ms }] };
  };
  it("real data opens following now, at the newest record", () => {
    useStore.getState().load(real());
    const s = useStore.getState();
    expect(s.following).toBe(true);
    expect(s.t).toBe(s.duration);
  });
  it("newer records are walked through at real speed, never jumped to", () => {
    const p1 = real();
    useStore.getState().load(p1);
    const end1 = useStore.getState().t0 + useStore.getState().t;
    useStore.getState().reload(later(p1, 4_000));
    expect(useStore.getState().t0 + useStore.getState().t).toBe(end1); // where the agents were
    useStore.getState().advance(1_000);
    expect(useStore.getState().t0 + useStore.getState().t).toBe(end1 + 1_000); // 1× while close behind
    for (let i = 0; i < 10; i++) useStore.getState().advance(1_000);
    const s = useStore.getState();
    expect(s.t).toBe(s.duration); // caught up: waits at the newest record
    expect(s.following).toBe(true);
  });
  it("far behind, it hurries until it is close behind again, then goes at real speed", () => {
    const p1 = real();
    useStore.getState().load(p1);
    useStore.getState().reload(later(p1, 60_000));
    for (let i = 0; i < 8; i++) useStore.getState().advance(1_000);
    const s = useStore.getState();
    expect(s.duration - s.t).toBeLessThanOrEqual(15_000);
    const before = s.t;
    useStore.getState().advance(1_000);
    expect(useStore.getState().t - before).toBeCloseTo(1_000, 0);
  });
  it("scrubbing leaves live; 实时 comes back to it", () => {
    useStore.getState().load(real());
    useStore.getState().setTime(0);
    expect(useStore.getState().following).toBe(false);
    useStore.getState().reload(later(real(), 5_000));
    expect(useStore.getState().t).toBe(0); // a scrubbed clock stays where the owner put it
    useStore.getState().setFollowing(true);
    for (let i = 0; i < 30; i++) useStore.getState().advance(1_000);
    expect(useStore.getState().t).toBe(useStore.getState().duration);
  });
});
