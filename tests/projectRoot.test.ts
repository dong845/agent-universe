import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadEvents } from "../packages/server/src/load.ts";
import { projectRoot } from "../packages/server/src/projectRoot.ts";
import { writeClaudeSession } from "./helpers/synthLogs.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "at-root-"));

describe("projectRoot", () => {
  it("walks up from a subdirectory to the repo with .git", () => {
    const d = tmp();
    mkdirSync(join(d, "repo/.git"), { recursive: true });
    mkdirSync(join(d, "repo/a/b"), { recursive: true });
    expect(projectRoot(join(d, "repo/a/b"))).toBe(join(d, "repo"));
    expect(projectRoot(join(d, "repo"))).toBe(join(d, "repo"));
  });

  it("treats a worktree's .git file as its own root", () => {
    const d = tmp();
    mkdirSync(join(d, "repo/.git"), { recursive: true });
    mkdirSync(join(d, "repo/wt/src"), { recursive: true });
    writeFileSync(join(d, "repo/wt/.git"), "gitdir: ../.git/worktrees/wt\n");
    expect(projectRoot(join(d, "repo/wt/src"))).toBe(join(d, "repo/wt"));
  });

  it("keeps the cwd when no repo is found, or the cwd no longer exists", () => {
    const d = tmp();
    mkdirSync(join(d, "plain/x"), { recursive: true });
    expect(projectRoot(join(d, "plain/x"), (p) => p.startsWith(d) && false)).toBe(join(d, "plain/x"));
    expect(projectRoot(join(d, "gone/away"))).toBe(join(d, "gone/away"));
  });

  it("stops at a Windows drive root without looping", () => {
    expect(projectRoot("C:\\x\\y", () => false)).toBe("C:\\x\\y");
    expect(projectRoot("C:\\x\\y", (p) => p === "C:\\x")).toBe("C:\\x");
  });
});

describe("loader groups sessions by repo", () => {
  it("two sessions in two subdirectories of one repo share one projectId", () => {
    const d = tmp();
    mkdirSync(join(d, "repo/.git"), { recursive: true });
    mkdirSync(join(d, "repo/a"), { recursive: true });
    mkdirSync(join(d, "repo/b"), { recursive: true });
    const claudeRoot = join(d, "logs");
    const tk = { input: 1, output: 1, cacheRead: 1, cacheWrite: 0 };
    writeClaudeSession(claudeRoot, { sessionId: "ra", cwd: join(d, "repo/a"), t0: 1e12, turns: [{ prompt: "a", tokens: tk }] });
    writeClaudeSession(claudeRoot, { sessionId: "rb", cwd: join(d, "repo/b"), t0: 1e12 + 5000, turns: [{ prompt: "b", tokens: tk }] });
    const r = loadEvents({ claudeRoot, codexRoot: join(d, "none"), cacheDir: null });
    expect(new Set(r.events.map((e) => e.projectId))).toEqual(new Set([join(d, "repo")]));
  });
});
