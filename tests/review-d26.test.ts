// Fixes from the D26 whole-branch review: each test reproduces a finding.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentTownEvent } from "../packages/schema/src/event.ts";
import { buildTimeline } from "../packages/web/src/orchestrator/timeline.ts";
import { uniqueAgents } from "../packages/web/src/orchestrator/sessionAgents.ts";

let n = 0;
const ev = (agentId: string, ts: number, kind: AgentTownEvent["kind"], extra: Partial<AgentTownEvent> = {}): AgentTownEvent =>
  ({ id: `e${n++}`, ts, faction: "claude-code", projectId: "/p", sessionId: "s1", taskId: "t1", agentId, kind, raw: { file: "", line: 0 }, ...extra });

afterEach(() => vi.unstubAllGlobals());

describe("a subagent reports back to its main agent (review: the remap broke it)", () => {
  it("the report walks to the same place with and without the per-session ids", () => {
    const events = [
      ev("main", 0, "task_start", { trigger: "human", title: "x" }),
      ev("main", 1000, "tool_start", { tool: "Agent", toolUseId: "ta", role: "commander" }),
      ev("sub", 1500, "agent_spawn", { parentAgentId: "main", agentType: "Explore" }),
      ev("main", 2000, "tool_start", { tool: "Edit", toolUseId: "te", role: "smith" }),
      // the subagent returns while the main agent is still out at its building
      ev("sub", 2100, "agent_return", {}),
    ];
    const target = (evs: AgentTownEvent[]) => buildTimeline(evs).actors.find((a) => a.id === "sub")!.actions.find((a) => a.pose === "report")!.to;
    expect(target(uniqueAgents(events))).toEqual(target(events));
  });
});

describe("the server survives a body that is not an object (review: JSON null crashed it)", () => {
  it("answers 400 and keeps serving", async () => {
    const { createServer } = await import("../packages/server/src/http.ts");
    const root = mkdtempSync(join(tmpdir(), "at-d26-"));
    const srv = createServer({
      load: async () => ({ events: [], requestOf: new Map(), mtimes: new Map() }) as never, staticDir: null, themesFile: join(root, "t.json"),
      watch: () => () => {}, reloadGapMs: 0, settingsFile: join(root, "s.json"), shareSecretFile: join(root, "k"),
      hookFiles: { claude: join(root, "c.json"), codex: join(root, "x.json") },
    });
    await new Promise<void>((r) => srv.server.listen(0, "127.0.0.1", r));
    const b = `http://127.0.0.1:${(srv.server.address() as { port: number }).port}`;
    for (const path of ["/api/ask?src=claude", "/api/hook?src=claude"]) {
      for (const body of ["null", "[]", "42"]) expect((await fetch(`${b}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body })).status, `${path} ${body}`).toBe(400);
    }
    expect((await fetch(`${b}/api/status`)).ok).toBe(true);
    srv.server.close();
  });
});

describe("a page left open across a server restart (review: stale token)", () => {
  it("fetches the new token and tries once more", async () => {
    const { sendAnswer, useDecision } = await import("../packages/web/src/ui/decision.ts");
    useDecision.getState().setToken("old");
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: { headers?: Record<string, string> }) => {
      if (url === "/api/status") return new Response(JSON.stringify({ token: "new" }));
      calls.push(init?.headers?.["x-agent-universe-token"] ?? "");
      return new Response("{}", { status: init?.headers?.["x-agent-universe-token"] === "new" ? 200 : 403 });
    });
    expect(await sendAnswer("a1", { behavior: "allow" })).toBe(true);
    expect(calls).toEqual(["old", "new"]);
    expect(useDecision.getState().token).toBe("new");
  });
});
