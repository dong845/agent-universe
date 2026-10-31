import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assignIdeas, resolveArt, type Manifest } from "../packages/web/src/v3/art.ts";

const manifest = JSON.parse(readFileSync(new URL("../art/manifest.json", import.meta.url), "utf8")) as Manifest;

describe("resolveArt over the interim set", () => {
  it("an exact match is not a fallback", () => {
    const a = resolveArt(manifest, { category: "house", theme: "publishing", kind: "docs", variant: "a" })!;
    expect([a.id, a.fallback, a.url]).toEqual(["publishing/house_docs_a", false, "/art/publishing/house_docs_a.webp"]);
    expect(a.anchor).toHaveLength(2);
    expect(a.footprint).toBeGreaterThan(0);
  });

  it("a missing theme and variant fall back along theme → craftsmen → publishing, then variant a", () => {
    const a = resolveArt(manifest, { category: "house", theme: "film", kind: "video", variant: "b" })!;
    expect([a.id, a.fallback]).toEqual(["publishing/house_video_a", true]);
  });

  it("a landmark takes the nearest tier, then any idea of the theme", () => {
    expect(resolveArt(manifest, { category: "landmark", theme: "publishing", idea: 1, tier: 3 })!.id).toBe("publishing/landmark_1_t2");
    expect(resolveArt(manifest, { category: "landmark", theme: "film", idea: 4, tier: 1 })!.id).toBe("publishing/landmark_1_t2");
  });

  it("a public building of the other faction, or the hall in place of a missing kind", () => {
    const a = resolveArt(manifest, { category: "public", work: "read", faction: "codex" })!;
    expect([a.id, a.fallback]).toEqual(["shared/public_read_claude-code", true]);
    expect(resolveArt(manifest, { category: "public", work: "test", faction: "codex" })!.id).toBe("shared/public_hall_claude-code");
  });

  it("misc: the other variant, the hall for a capital, a tent for the outpost; unknown props are skipped", () => {
    expect(resolveArt(manifest, { category: "misc", name: "tent_b" })!.id).toBe("shared/misc_tent_a");
    expect(resolveArt(manifest, { category: "misc", name: "capital_codex", faction: "codex" })!.id).toBe("shared/public_hall_claude-code");
    expect(resolveArt(manifest, { category: "misc", name: "outpost" })!.id).toBe("shared/misc_tent_a");
    expect(resolveArt(manifest, { category: "prop", name: "well" })).toBeNull();
  });

  it("an empty manifest resolves nothing, without throwing", () => {
    expect(resolveArt({}, { category: "house", theme: "film", kind: "code", variant: "a" })).toBeNull();
  });
});

describe("assignIdeas", () => {
  it("towns of one theme get different landmark ideas, wrapping after six, stable by key", () => {
    const towns = ["a", "b", "c", "d", "e", "f", "g"].map((k) => ({ key: k, theme: "film" })).concat([{ key: "z", theme: "publishing" }]);
    const m = assignIdeas(towns);
    expect(["a", "b", "c", "d", "e", "f", "g"].map((k) => m.get(k))).toEqual([1, 2, 3, 4, 5, 6, 1]);
    expect(m.get("z")).toBe(1);
    expect(assignIdeas([...towns].reverse())).toEqual(m);
  });
});
