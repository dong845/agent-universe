import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseClaudeSession } from "../packages/adapter-claude/src/index.ts";
import { parseCodexThread, rolloutHead } from "../packages/adapter-codex/src/index.ts";
import { addTokens, zeroTokens, type AgentTownEvent } from "../packages/schema/src/event.ts";
import { loadRoles } from "../packages/schema/src/roles.ts";
import { titleOf } from "../packages/schema/src/title.ts";
import { newStats } from "../packages/schema/src/util.ts";
import { writeClaudeSession, writeCodexRollout, type SynthSession } from "./helpers/synthLogs.ts";

const roles = loadRoles();
const tk = (input: number, output: number, cacheRead: number, cacheWrite = 0) => ({ input, output, cacheRead, cacheWrite });
const sum = (evs: AgentTownEvent[]) => evs.filter((e) => e.kind === "model_call").reduce((a, e) => addTokens(a, e.tokens!), zeroTokens());

describe("titleOf", () => {
  it("takes the first non-empty line", () => expect(titleOf("  修复登录\n第二行")).toBe("修复登录"));
  it("cuts at 80 characters with an ellipsis", () => expect(titleOf("x".repeat(100))).toBe("x".repeat(80) + "…"));
  it("keeps exactly 80 characters uncut", () => expect(titleOf("y".repeat(80))).toBe("y".repeat(80)));
  it("gives nothing for blank text", () => expect(titleOf(" \n ")).toBeUndefined());
});

describe("task titles from the adapters", () => {
  const dir = mkdtempSync(join(tmpdir(), "at-adapters-"));
  const spec: SynthSession = {
    sessionId: "s-claude-1",
    cwd: "/synth/shop",
    t0: Date.UTC(2026, 9, 1),
    turns: [
      { prompt: "Fix the checkout bug\nmore detail", tools: [{ name: "Read", input: { file_path: "/synth/shop/src/a.ts" } }], tokens: tk(10, 20, 300, 40) },
      { prompt: "第二个任务", tokens: tk(1, 2, 3, 4) },
    ],
  };

  it("Claude: the first line of the opening user message", () => {
    const r = parseClaudeSession(writeClaudeSession(join(dir, "claude"), spec), roles, newStats());
    const starts = r.events.filter((e) => e.kind === "task_start");
    expect(starts.map((e) => e.title)).toEqual(["Fix the checkout bug", "第二个任务"]);
    expect(sum(r.events)).toEqual(tk(11, 22, 303, 44));
  });

  it("Codex: the first user_message inside the task", () => {
    const path = writeCodexRollout(join(dir, "codex"), { ...spec, sessionId: "s-codex-1", turns: [{ prompt: "重构 search index", tools: [{ name: "exec_command", input: { cmd: "rg foo src" } }], tokens: tk(5, 6, 70) }] });
    const r = parseCodexThread([rolloutHead(path, newStats())!], roles, newStats());
    expect(r.events.filter((e) => e.kind === "task_start").map((e) => e.title)).toEqual(["重构 search index"]);
    expect(sum(r.events)).toEqual({ ...tk(5, 6, 70), reasoning: 0 });
  });
});
