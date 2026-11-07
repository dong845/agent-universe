// The owner's town choices (spec 2026-11-07 D27 A2-A5): names, hidden towns and merges, in
// ~/.agent-town/towns.json. A damaged or hand-edited file never breaks the world.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyMerge, readTownPrefs, resolveMerge, writeTownPrefs } from "../packages/server/src/townPrefs.ts";
import { buildTowns } from "../packages/schema/src/towns.ts";
import { CAPITAL } from "../packages/schema/src/towns.ts";
import { townOptions } from "../packages/server/src/payload.ts";

const dir = mkdtempSync(join(tmpdir(), "townprefs-"));
const file = (name: string, body: string) => { const f = join(dir, name); writeFileSync(f, body); return f; };

describe("reading towns.json", () => {
  it("missing or damaged: nothing set", () => {
    const empty = { names: {}, hidden: [], merge: {} };
    expect(readTownPrefs(join(dir, "none.json"))).toEqual(empty);
    expect(readTownPrefs(file("bad.json", "{oops"))).toEqual(empty);
    expect(readTownPrefs(file("arr.json", "[1,2]"))).toEqual(empty);
    expect(readTownPrefs(file("null.json", "null"))).toEqual(empty);
  });
  it("keeps only well-formed entries: trimmed names (≤ 60 chars), string keys, same-side merges", () => {
    const f = file("mixed.json", JSON.stringify({
      names: { "codex|/a": "  Alpha  ", "codex|/b": 7, "codex|/c": "   ", "codex|/d": "x".repeat(80) },
      hidden: ["codex|/a", 3, null],
      merge: { "codex|/a": "codex|/b", "codex|/c": "claude-code|/c", "codex|/e": "codex|/e", "codex|/f": 9 },
    }));
    const p = readTownPrefs(f);
    expect(p.names).toEqual({ "codex|/a": "Alpha", "codex|/d": "x".repeat(60) });
    expect(p.hidden).toEqual(["codex|/a"]);
    expect(p.merge).toEqual({ "codex|/a": "codex|/b" });
  });
  it("writes what it reads", () => {
    const f = join(dir, "sub", "towns.json");
    writeTownPrefs(f, { names: { "codex|/a": "A" }, hidden: ["codex|/b"], merge: { "codex|/c": "codex|/d" } });
    expect(readTownPrefs(f)).toEqual({ names: { "codex|/a": "A" }, hidden: ["codex|/b"], merge: { "codex|/c": "codex|/d" } });
  });
});

describe("resolving merges", () => {
  const exists = (keys: string[]) => (k: string) => keys.includes(k);
  it("follows a chain to its end", () => {
    expect(resolveMerge({ "codex|/a": "codex|/b", "codex|/b": "codex|/c" }, exists(["codex|/a", "codex|/b", "codex|/c"]))).toEqual(new Map([["codex|/a", "codex|/c"], ["codex|/b", "codex|/c"]]));
  });
  it("drops a cycle and never loops", () => {
    expect(resolveMerge({ "codex|/a": "codex|/b", "codex|/b": "codex|/a" }, exists(["codex|/a", "codex|/b"]))).toEqual(new Map());
  });
  it("a target that no longer exists keeps the requests where they are", () => {
    expect(resolveMerge({ "codex|/a": "codex|/gone" }, exists(["codex|/a"]))).toEqual(new Map());
  });
  it("never merges the capital or the field camp, either way", () => {
    expect(resolveMerge({ [`codex|${CAPITAL}`]: "codex|/b", "codex|/a": `codex|${CAPITAL}` }, exists([`codex|${CAPITAL}`, "codex|/a", "codex|/b"]))).toEqual(new Map());
  });
  it("moves every event of a merged town to its target", () => {
    const ev = (projectId: string, faction = "codex") => ({ faction, projectId }) as never;
    const events = [ev("/a"), ev("/b"), ev("/a", "claude-code")];
    applyMerge(events, new Map([["codex|/a", "codex|/b"]]));
    expect(events.map((e: { faction: string; projectId: string }) => `${e.faction}|${e.projectId}`)).toEqual(["codex|/b", "codex|/b", "claude-code|/a"]);
  });
});

describe("names and hidden towns in the world", () => {
  const req = (projectId: string) => ({ requestId: projectId, faction: "codex", projectId, class: "produced" }) as never;
  const opts = (names: Record<string, string>, hidden: string[]) => ({ ...townOptions({ overrides: {}, guildSkillsOf: () => [], describe: () => undefined }), names, hidden });
  it("a name replaces the folder's name, which stays known; hidden towns are marked", () => {
    const towns = buildTowns([req("/w/alpha"), req("/w/beta")], [], opts({ "codex|/w/alpha": "My app" }, ["codex|/w/beta"]));
    const a = towns.find((t) => t.projectId === "/w/alpha")!;
    const b = towns.find((t) => t.projectId === "/w/beta")!;
    expect([a.name, a.folderName, a.hidden]).toEqual(["My app", "alpha", undefined]);
    expect([b.name, b.hidden]).toEqual(["beta", true]);
  });
});
