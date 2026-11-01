import { describe, expect, it } from "vitest";
import { resumeCommand } from "../packages/schema/src/resume.ts";

describe("resumeCommand", () => {
  it("Claude: from the session's own folder, quoted", () => {
    expect(resumeCommand("claude-code", "abc", "/a b/c'd")).toBe(`cd '/a b/c'\\''d' && claude --resume abc`);
  });
  it("Codex: codex resume, with cd when the folder is known", () => {
    expect(resumeCommand("codex", "thr_1")).toBe("codex resume thr_1");
    expect(resumeCommand("codex", "thr_1", "/w")).toBe("cd '/w' && codex resume thr_1");
  });
  it("no folder: no cd", () => expect(resumeCommand("claude-code", "abc")).toBe("claude --resume abc"));
  it("an id that is not a plain id is quoted too", () => expect(resumeCommand("claude-code", "a;rm -rf x")).toBe("claude --resume 'a;rm -rf x'"));
});
