// The mini window's rows (spec 2026-11-05 C2): sessions waiting on you first, then the ones working.
import { describe, expect, it } from "vitest";
import type { Attention } from "../packages/schema/src/attention.ts";
import type { AgentTownEvent } from "../packages/schema/src/event.ts";
import { miniRows } from "../packages/web/src/ui/miniRows.ts";
import { dismissKey } from "../packages/web/src/ui/dismiss.ts";

const base = { faction: "claude-code" as const, projectId: "/p", sessionId: "s", raw: { file: "", line: 0 } };
let n = 0;
const ev = (taskId: string, ts: number, kind: AgentTownEvent["kind"], extra: Partial<AgentTownEvent> = {}): AgentTownEvent => ({ ...base, id: `e${n++}`, ts, agentId: "a", taskId, kind, ...extra });
const req = (requestId: string, projectId: string, taskIds: string[]) => [requestId, { requestId, faction: "claude-code" as const, projectId, taskIds }] as const;
const w = { live: new Set(["r1", "r2", "r3"]), requests: new Map([req("r1", "/one", ["t1"]), req("r2", "/two", ["t2"]), req("r3", "/three", ["t3"])]) };
const events = [
  ev("t1", 100, "tool_start", { role: "smith", tool: "Edit", toolUseId: "u1" }),
  ev("t2", 300, "tool_start", { role: "scout", tool: "Read", toolUseId: "u2" }),
  ev("t2", 310, "tool_end", { toolUseId: "u2" }),
  ev("t3", 50, "model_call"),
];
const att = (requestId: string, state: Attention["state"], since: number): Attention => ({ session: `s-${requestId}`, faction: "claude-code", sessionId: `s-${requestId}`, projectId: requestId === "r3" ? "/three" : "/x", requestId, state, since, exact: false });
const names = (k: string) => k.split("/").pop()!;

describe("miniRows", () => {
  it("waiting sessions first, with their faces; working ones after, newest activity first", () => {
    const r = miniRows({ w, events, attention: [att("r3", "waiting", 40), att("rx", "error", 60)], closed: {}, now: 400, names });
    expect(r.attention.map((x) => [x.town, x.face])).toEqual([["three", "wide"], ["x", "error"]]);
    // r3 waits on you, so it is not listed again among the working
    expect(r.live.map((x) => [x.town, x.face])).toEqual([["two", "think"], ["one", "focus"]]);
    expect(r.live[1].doing).toEqual({ role: "smith", tool: "Edit" });
    expect(r.live[1].sinceMs).toBe(300);
    expect(r.live[0].doing).toBeNull();
  });
  it("a closed entry is not shown; a finished turn smiles", () => {
    const a = att("r3", "turn-done", 40);
    expect(miniRows({ w, events, attention: [a], closed: { [a.session]: dismissKey(a) }, now: 400, names }).attention).toEqual([]);
    expect(miniRows({ w, events, attention: [a], closed: {}, now: 400, names }).attention[0].face).toBe("happy");
  });
  it("a request quiet for longer than the live window (10 min) is not 'working'", () => {
    const r = miniRows({ w, events, attention: [], closed: {}, now: 400, clock: 310 + 600_001, names });
    expect(r.live.map((x) => x.town)).toEqual([]);
    expect(miniRows({ w, events, attention: [], closed: {}, now: 400, clock: 100 + 600_001, names }).live.map((x) => x.town)).toEqual(["two"]);
  });
  it("nothing live, nothing waiting: no rows", () => {
    expect(miniRows({ w: { live: new Set(), requests: new Map() }, events: [], attention: [], closed: {}, now: 0, names })).toEqual({ attention: [], live: [] });
  });
});
