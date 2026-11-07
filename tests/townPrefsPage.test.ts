// The page side of town choices (spec 2026-11-07 D27 A1/A4).
import { describe, expect, it } from "vitest";
import { keyName, mergeTargets, townNote } from "../packages/web/src/ui/townPrefs.ts";

const town = (key: string, name: string, kind = "project", faction = key.split("|")[0]) => ({ key, name, kind, faction }) as never;

describe("merge targets", () => {
  const towns = [town("codex|/a", "alpha"), town("codex|/b", "beta"), town("codex|/g", "guild", "guild"), town("codex|都城", "都城", "capital"), town("claude-code|/a", "alpha"), town("codex|野外营地", "野外营地", "outpost")];
  it("same side, projects and guilds, not itself, by name", () => {
    expect(mergeTargets(towns, "codex|/a").map((x: { key: string }) => x.key)).toEqual(["codex|/b", "codex|/g"]);
  });
  it("the capital, the field camp and unknown towns merge nowhere", () => {
    expect(mergeTargets(towns, "codex|都城")).toEqual([]);
    expect(mergeTargets(towns, "codex|野外营地")).toEqual([]);
    expect(mergeTargets(towns, "codex|/zzz")).toEqual([]);
  });
});

describe("notes and names", () => {
  it("the capital and the field camp say what they hold; others say nothing", () => {
    expect(townNote({ kind: "capital" })).toContain("~/.claude");
    expect(townNote({ kind: "outpost" })).toContain("临时");
    expect(townNote({ kind: "project" })).toBeNull();
  });
  it("a key's last folder", () => {
    expect(keyName("codex|/Users/x/Documents/slides_maker/")).toBe("slides_maker");
  });
});
