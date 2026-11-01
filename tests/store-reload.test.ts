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
