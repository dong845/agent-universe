// Simulated events for the 3D prototype (plan phase 0, "mock data generator v0"). Every event has the
// exact shape the real adapters produce, so the world can switch to real data unchanged. Nothing here
// comes from a real session: paths, titles and token counts are invented for the demo and the UI says so.
import type { AgentTownEvent, Role, Tokens } from "../../schema/src/event.ts";

/** readable, unique ids; the browser bundle must not pull in node:crypto */
function hashId(...parts: string[]): string {
  return parts.join(":");
}

export const DEMO = {
  t0: Date.UTC(2026, 9, 20, 2, 0, 0),
  projectId: "/demo/web-shop",
  sessionId: "demo-session-1",
  model: "demo-model",
  contextMax: 200_000,
} as const;

type Status = "ok" | "error" | "denied";

class Builder {
  events: AgentTownEvent[] = [];
  private seq = 0;
  taskId: string | null = null;

  private base(agentId: string, sec: number) {
    this.seq++;
    return {
      faction: "claude-code" as const,
      projectId: DEMO.projectId,
      sessionId: DEMO.sessionId,
      taskId: this.taskId,
      agentId,
      ts: DEMO.t0 + Math.round(sec * 1000),
      raw: { file: "demo", line: this.seq },
    };
  }

  taskStart(sec: number, title: string) {
    this.taskId = hashId("demo", "task", String(sec));
    this.events.push({ ...this.base("main", sec), id: this.taskId, kind: "task_start", trigger: "human", title });
  }

  taskEnd(sec: number) {
    this.events.push({ ...this.base("main", sec), id: hashId("demo", this.taskId!, "end"), kind: "task_end", status: "ok" });
  }

  think(agentId: string, sec: number, t: Tokens, role: Role = agentId === "main" ? "commander" : "scout") {
    this.events.push({
      ...this.base(agentId, sec), id: hashId("demo", agentId, "model", String(sec)), kind: "model_call", role,
      model: DEMO.model, tokens: t, contextUsed: t.input + t.cacheRead + t.cacheWrite, contextMax: DEMO.contextMax,
    });
  }

  /** a tool call from start to its result */
  tool(agentId: string, sec: number, durSec: number, tool: string, role: Role, target: string, status: Status = "ok") {
    const toolUseId = hashId("demo", agentId, tool, String(sec));
    this.events.push({ ...this.base(agentId, sec), id: hashId("demo", toolUseId, "start"), kind: "tool_start", tool, toolUseId, role, target });
    const end = { ...this.base(agentId, sec + durSec), id: hashId("demo", toolUseId, "end"), kind: "tool_end" as const, toolUseId, status, durationMs: Math.round(durSec * 1000) };
    this.events.push(end);
    return toolUseId;
  }

  /** an Agent call that spawns a subagent; the call's result arrives when the subagent returns */
  spawn(sec: number, agentId: string, agentType: string, role: Role, agentTask: string) {
    const toolUseId = hashId("demo", "spawn", agentId);
    this.events.push({ ...this.base("main", sec), id: hashId("demo", toolUseId, "start"), kind: "tool_start", tool: "Agent", toolUseId, role: "commander", target: agentTask });
    this.events.push({
      ...this.base(agentId, sec + 0.1), id: hashId("demo", agentId, "spawn"), kind: "agent_spawn", parentAgentId: "main",
      spawnToolUseId: toolUseId, spawnLink: "exact", agentType, agentTask, role,
    });
    return toolUseId;
  }

  ret(sec: number, agentId: string, spawnToolUseId: string, spawnSec: number) {
    this.events.push({ ...this.base(agentId, sec), id: hashId("demo", agentId, "return"), kind: "agent_return" });
    this.events.push({
      ...this.base("main", sec + 0.1), id: hashId("demo", spawnToolUseId, "end"), kind: "tool_end", toolUseId: spawnToolUseId,
      status: "ok", durationMs: Math.round((sec + 0.1 - spawnSec) * 1000),
    });
  }

  awaiting(agentId: string, sec: number) {
    this.events.push({ ...this.base(agentId, sec), id: hashId("demo", agentId, "await", String(sec)), kind: "awaiting_user" });
  }

  compaction(agentId: string, sec: number, preTokens: number, postTokens: number) {
    this.events.push({
      ...this.base(agentId, sec), id: hashId("demo", agentId, "compact", String(sec)), kind: "compaction",
      compaction: { preTokens, postTokens, trigger: "auto" },
    });
  }
}

const tk = (input: number, cacheRead: number, cacheWrite: number, output: number): Tokens => ({ input, output, cacheRead, cacheWrite });

/**
 * One task, two parallel subagents, a failing-test loop that turns into rework, a compaction, a
 * permission wait, a denied command and a tool error: every behaviour the prototype must show.
 */
export function demoScenario(): AgentTownEvent[] {
  const b = new Builder();
  const SHOP = "src/http/client.ts";
  b.taskStart(0, "给 HTTP 客户端加上失败重试，并补上测试");
  b.think("main", 1.5, tk(2400, 15000, 6000, 380));
  b.tool("main", 2.0, 0.3, "TodoWrite", "scribe", "计划：4 项");
  b.think("main", 3.0, tk(300, 21000, 900, 160));
  b.tool("main", 3.5, 0.4, "Read", "scout", SHOP);
  b.tool("main", 4.5, 0.5, "Grep", "scout", "fetchJson");
  b.think("main", 6.0, tk(1800, 22000, 3000, 520));

  // two subagents from one message, working in parallel
  const sa = b.spawn(7.0, "agent-scout", "Explore", "scout", "找出 fetchJson 的全部调用方");
  const sb = b.spawn(7.0, "agent-tests", "general-purpose", "commander", "为重试逻辑写单元测试");
  b.think("agent-scout", 8.5, tk(1200, 9000, 2500, 210), "scout");
  b.tool("agent-scout", 9.0, 0.6, "Grep", "scout", "fetchJson(");
  b.think("agent-scout", 10.5, tk(900, 11500, 1400, 180), "scout");
  b.tool("agent-scout", 11.0, 0.3, "Read", "scout", "src/cart/api.ts");
  b.tool("agent-scout", 12.0, 0.3, "Read", "scout", "src/user/api.ts");
  b.think("agent-scout", 13.5, tk(700, 13000, 1900, 640), "scout");
  b.think("agent-tests", 8.0, tk(1500, 9000, 2600, 240), "commander");
  b.tool("agent-tests", 9.0, 0.4, "Read", "scout", SHOP);
  b.think("agent-tests", 10.5, tk(800, 12000, 2100, 900), "commander");
  b.tool("agent-tests", 11.5, 0.5, "Write", "smith", "test/http/retry.test.ts");
  b.think("agent-tests", 13.0, tk(400, 14500, 1200, 150), "commander");
  b.tool("agent-tests", 13.5, 2.5, "Bash", "inspector", "pnpm vitest run test/http/retry.test.ts", "error");
  b.think("agent-tests", 17.0, tk(1100, 15600, 800, 420), "commander");
  b.ret(14.5, "agent-scout", sa, 7.0);
  b.ret(18.5, "agent-tests", sb, 7.0);

  // the edit → failing test loop that becomes rework
  b.think("main", 19.5, tk(3500, 30000, 5200, 1400));
  b.tool("main", 20.5, 1.2, "WebFetch", "messenger", "https://example.org/docs/retry-after");
  b.think("main", 22.5, tk(1600, 38700, 2100, 900));
  b.tool("main", 23.5, 0.3, "Edit", "smith", SHOP);
  b.tool("main", 25.0, 3.0, "Bash", "inspector", "pnpm vitest run", "error");
  b.think("main", 28.5, tk(2600, 70000, 4400, 760));
  b.tool("main", 29.5, 0.3, "Edit", "smith", SHOP);
  b.tool("main", 31.0, 3.0, "Bash", "inspector", "pnpm vitest run", "error");
  b.think("main", 34.5, tk(3100, 160000, 6900, 520)); // context 170k of 200k: the backpack turns red
  b.compaction("main", 35.0, 172_000, 31_000);
  b.think("main", 36.5, tk(9000, 0, 24000, 610));
  b.tool("main", 37.5, 0.3, "Edit", "smith", SHOP); // third edit inside the failing stretch: rework cloud
  b.tool("main", 38.0, 0.3, "Edit", "smith", "src/http/backoff.ts");
  b.tool("main", 39.5, 3.2, "Bash", "inspector", "pnpm vitest run");
  b.think("main", 43.0, tk(1300, 33000, 1600, 340));

  // a command that needs the user's approval, a denied one, and a tool error
  b.tool("main", 44.0, 5.4, "Bash", "engineer", "git commit -m \"retry with backoff\"");
  b.awaiting("main", 44.1);
  b.tool("main", 51.0, 0.3, "Bash", "engineer", "rm -rf dist", "denied");
  b.tool("main", 52.5, 0.2, "Read", "scout", "src/http/missing.ts", "error");
  b.think("main", 54.0, tk(900, 35500, 1200, 700));
  b.taskEnd(55.0);
  return b.events.sort((x, y) => x.ts - y.ts);
}
