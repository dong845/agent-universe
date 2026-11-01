// Attention states (spec 2026-11-01 A2) from hand-built events: which sessions need the owner now.
import { describe, expect, it } from "vitest";
import { attentionOf, type HookSignal } from "../packages/schema/src/attention.ts";
import type { AgentTownEvent, Faction } from "../packages/schema/src/event.ts";

const NOW = Date.UTC(2026, 10, 1, 12);
let n = 0;
function ev(kind: AgentTownEvent["kind"], agoMs: number, extra: Partial<AgentTownEvent> = {}, faction: Faction = "claude-code", session = "s1"): AgentTownEvent {
  return { id: `e${n++}`, ts: NOW - agoMs, faction, projectId: "/synthetic/p", sessionId: session, taskId: `${session}-t1`, agentId: "main", kind, ...extra };
}
/** a turn started 60 s ago, with these events after it */
function turn(rest: AgentTownEvent[], start: Partial<AgentTownEvent> = {}, faction: Faction = "claude-code", session = "s1"): AgentTownEvent[] {
  return [ev("task_start", 60_000, { permissionMode: "default", ...start }, faction, session), ...rest];
}
const call = (tool: string, ago: number, f: Faction = "claude-code", s = "s1") => ev("tool_start", ago, { tool, toolUseId: `${tool}-${ago}` }, f, s);
const at = (events: AgentTownEvent[], hooks: HookSignal[] = []) => attentionOf(events, NOW, hooks, new Map([["s1-t1", "r1"]]));

describe("maybe-waiting", () => {
  it("an open shell call older than 20 s", () => {
    const a = at(turn([call("Bash", 25_000)]));
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ session: "claude-code|s1", state: "maybe-waiting", exact: false, tool: "Bash", requestId: "r1", since: NOW - 25_000 });
  });
  it("not before 20 s", () => expect(at(turn([call("Bash", 15_000)]))).toEqual([]));
  it("not for read-only tools", () => expect(at(turn([call("Read", 60_000 - 1)]))).toEqual([]));
  it("not for subagent spawns", () => expect(at(turn([call("Agent", 50_000)]))).toEqual([]));
  it("not when permissions are bypassed or in auto mode", () => {
    expect(at(turn([call("Bash", 25_000)], { permissionMode: "bypassPermissions" }))).toEqual([]);
    expect(at(turn([call("Bash", 25_000)], { permissionMode: "auto" }))).toEqual([]);
  });
  it("acceptEdits: edits never wait, shell still can", () => {
    expect(at(turn([call("Edit", 25_000)], { permissionMode: "acceptEdits" }))).toEqual([]);
    expect(at(turn([call("Bash", 25_000)], { permissionMode: "acceptEdits" }))[0]?.state).toBe("maybe-waiting");
  });
  it("not for Codex with approval policy never", () => {
    expect(attentionOf(turn([call("exec_command", 25_000, "codex")], { permissionMode: "never" }, "codex"), NOW, [], new Map())).toEqual([]);
  });
  it("cleared when the call returns", () => {
    const c = call("Bash", 25_000);
    expect(at(turn([c, ev("tool_end", 1000, { toolUseId: c.toolUseId, status: "ok" })]))).toEqual([]);
  });
  it("a subagent's open call counts for its session", () => {
    const sub = { ...call("Bash", 30_000), agentId: "sub-1" };
    expect(at(turn([call("Agent", 50_000), sub]))[0]).toMatchObject({ state: "maybe-waiting", tool: "Bash" });
  });
});

describe("turn-done and error", () => {
  it("a finished turn with nothing newer", () => {
    expect(at(turn([ev("task_end", 5000)]))[0]).toMatchObject({ state: "turn-done", since: NOW - 5000 });
  });
  it("a newer turn clears it", () => {
    const e = turn([ev("task_end", 50_000)]);
    expect(at([...e, ev("task_start", 1000, { taskId: "s1-t2" })])).toEqual([]);
  });
  it("an API error settled for 10 s", () => {
    expect(at(turn([ev("error", 12_000)]))[0]).toMatchObject({ state: "error" });
    expect(at(turn([ev("error", 5000)]))).toEqual([]);
  });
  it("a Codex abort is a finished turn, not an error", () => {
    const e = turn([ev("task_end", 5000, { status: "error" }, "codex")], {}, "codex");
    expect(attentionOf(e, NOW, [], new Map())[0]?.state).toBe("turn-done");
  });
});

describe("hooks", () => {
  it("a permission hook newer than the last event makes it exact", () => {
    const a = at(turn([call("Bash", 25_000)]), [{ session: "claude-code|s1", event: "Notification", kind: "permission", ts: NOW - 24_000 }]);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ state: "waiting", exact: true });
  });
  it("a permission hook works before the 20 s guess would", () => {
    expect(at(turn([call("Bash", 3000)]), [{ session: "claude-code|s1", event: "Notification", kind: "permission", ts: NOW - 2000 }])[0]?.state).toBe("waiting");
  });
  it("a Codex PermissionRequest hook is exact too", () => {
    const e = turn([call("exec_command", 3000, "codex")], {}, "codex");
    expect(attentionOf(e, NOW, [{ session: "codex|s1", event: "PermissionRequest", kind: "permission", ts: NOW - 2000 }], new Map())[0]).toMatchObject({ state: "waiting", exact: true });
  });
  it("an event newer than the hook clears it", () => {
    const c = call("Bash", 25_000);
    const a = at(turn([c, ev("tool_end", 1000, { toolUseId: c.toolUseId })]), [{ session: "claude-code|s1", event: "Notification", kind: "permission", ts: NOW - 24_000 }]);
    expect(a).toEqual([]);
  });
});

describe("the list", () => {
  it("drops sessions outside the live window", () => {
    const old = [ev("task_start", 700_000), ev("task_end", 650_000)];
    expect(at(old)).toEqual([]);
  });
  it("one entry per session, most urgent first", () => {
    const a = attentionOf(
      [...turn([ev("task_end", 2000)], {}, "claude-code", "s1"), ...turn([call("Bash", 30_000, "claude-code", "s2")], {}, "claude-code", "s2"), ...turn([ev("error", 40_000, {}, "claude-code", "s3")], {}, "claude-code", "s3")].sort((x, y) => x.ts - y.ts),
      NOW, [{ session: "claude-code|s4", event: "Notification", kind: "permission", ts: NOW - 1000 }], new Map(),
    );
    expect(a.map((x) => `${x.session}:${x.state}`)).toEqual(["claude-code|s2:maybe-waiting", "claude-code|s3:error", "claude-code|s1:turn-done"]);
  });
});
