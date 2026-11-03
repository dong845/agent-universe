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

describe("live data catches up instead of jumping (owner 2026-11-03: agents teleported)", () => {
  it("a newer world arriving while the clock follows now plays the missed stretch quickly, then stops at the new end", () => {
    const p1 = { ...demoPayload(), source: "real" as const };
    useStore.getState().load(p1);
    useStore.getState().setSpeed(1);
    const s1 = useStore.getState();
    const end1 = s1.t0 + s1.duration;
    expect(s1.t).toBe(s1.duration); // real data opens at now
    const last = p1.events[p1.events.length - 1];
    const later = { ...last, id: "later-event", ts: last.ts + 60_000 };
    const p2 = { ...p1, events: [...p1.events, later] };
    useStore.getState().reload(p2);
    const s2 = useStore.getState();
    expect(s2.t0 + s2.t).toBe(end1); // still where the agents were
    expect(s2.playing).toBe(true);
    expect(s2.speed).toBeGreaterThan(1);
    for (let i = 0; i < 200 && useStore.getState().playing; i++) useStore.getState().advance(100);
    const s3 = useStore.getState();
    expect(s3.t).toBe(s3.duration);
    expect(s3.playing).toBe(false);
    expect(s3.speed).toBe(1); // the owner's speed comes back
  });
});
