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

describe("turns not opened by a human prompt", () => {
  it("continue the session's last human task by name, and say what opened them", () => {
    const dir = mkdtempSync(join(tmpdir(), "at-cont-"));
    const r = parseClaudeSession(writeClaudeSession(dir, {
      sessionId: "s-cont", cwd: "/synth/x", t0: Date.UTC(2026, 9, 2),
      turns: [
        { prompt: "把世界做大", tokens: tk(1, 1, 1) },
        { prompt: "subagent report", opener: "peer", tokens: tk(1, 1, 1) },
        { prompt: "summary of the conversation", opener: "compact", tokens: tk(1, 1, 1) },
      ],
    }), roles, newStats());
    const starts = r.events.filter((e) => e.kind === "task_start");
    expect(starts.map((e) => [e.trigger, e.title, e.continues, e.triggerBy])).toEqual([
      ["human", "把世界做大", undefined, undefined],
      ["system", undefined, "把世界做大", "peer"],
      ["system", undefined, "把世界做大", "compact"],
    ]);
  });
});

describe("tool_start files (v3 step 1)", () => {
  const dir = mkdtempSync(join(tmpdir(), "at-files-"));
  const long = "/synth/shop/" + "deep/".repeat(40) + "page.tsx";
  const claude = (tools: SynthSession["turns"][0]["tools"]) => {
    const spec: SynthSession = { sessionId: `s-files-${Math.random()}`, cwd: "/synth/shop", t0: Date.UTC(2026, 9, 2), turns: [{ prompt: "go", tools, tokens: tk(1, 1, 0) }] };
    return parseClaudeSession(writeClaudeSession(join(dir, "claude"), spec), roles, newStats()).events.filter((e) => e.kind === "tool_start");
  };

  it("claude tool_start carries the full file path even when the target is clipped", () => {
    const [w, r] = claude([{ name: "Write", input: { file_path: long, content: "x" } }, { name: "Read", input: { file_path: "/synth/shop/a.md" } }]);
    expect(w.target!.endsWith("…")).toBe(true);
    expect(w.files).toEqual([{ path: long, access: "edit" }]);
    expect(r.files).toEqual([{ path: "/synth/shop/a.md", access: "read" }]);
  });

  it("claude Skill tool target is the skill name", () => {
    const [s] = claude([{ name: "Skill", input: { skill: "superpowers:brainstorming", args: "x" } }]);
    expect(s.target).toBe("superpowers:brainstorming");
  });

  it("codex apply_patch lists every patched file", () => {
    const patch = `*** Begin Patch\n*** Add File: a/one.ts\n+x\n*** Update File: ${long}\n@@\n-a\n+b\n*** Delete File: b/two.md\n*** End Patch`;
    const spec: SynthSession = { sessionId: "s-codex-files", cwd: "/w", t0: Date.UTC(2026, 9, 2), turns: [{ prompt: "go", tools: [{ name: "apply_patch", input: { input: patch } }], tokens: tk(1, 1, 0) }] };
    const head = rolloutHead(writeCodexRollout(join(dir, "codex"), spec), newStats())!;
    const [s] = parseCodexThread([head], roles, newStats()).events.filter((e) => e.kind === "tool_start");
    expect(s.files).toEqual([
      { path: "/w/a/one.ts", access: "edit" },
      { path: long, access: "edit" },
      { path: "/w/b/two.md", access: "edit" },
    ]);
  });

  it("tools without files have no files field", () => {
    const [b] = claude([{ name: "Bash", input: { command: "ls" } }]);
    expect(b.files).toBeUndefined();
  });
});

import { patchFiles } from "../packages/adapter-codex/src/index.ts";

describe("patchFiles on escaped patches", () => {
  it("stops a path at a written-out \\n, as some shells pass the patch", () => {
    const text = String.raw`apply_patch "*** Begin Patch\n*** Update File: /w/src/a.ts\n@@\n-x\n+y\n*** Add File: /w/skills/k/b.py\n+print(1)\n*** End Patch"`;
    expect(patchFiles(text, "/w")).toEqual([{ path: "/w/src/a.ts", access: "edit" }, { path: "/w/skills/k/b.py", access: "edit" }]);
  });
  it("drops a header whose path is not a path", () => {
    expect(patchFiles("*** Update File: \n*** Add File: " + "x".repeat(2000) + "\n", "/w")).toBeUndefined();
  });
});
