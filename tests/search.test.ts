// Find a project by name (spec 2026-11-05 B3).
import { describe, expect, it } from "vitest";
import { searchTowns } from "../packages/web/src/galaxy/search.ts";

const towns = ["web-shop", "Agent Town", "shop-admin", "docs-site", "智能体宇宙", "my-web-tools", "codex|web-shop"].map((name, i) => ({ key: `k${i}`, name }));
const names = (q: string, limit?: number) => searchTowns(towns, q, limit).map((t) => t.name);

describe("searchTowns", () => {
  it("prefix first, then the start of a word, then anywhere", () => {
    expect(names("shop")).toEqual(["shop-admin", "web-shop", "codex|web-shop"]);
    expect(names("web")).toEqual(["web-shop", "my-web-tools", "codex|web-shop"]);
  });
  it("ignores case and works on Chinese names", () => {
    expect(names("agent")).toEqual(["Agent Town"]);
    expect(names("TOWN")).toEqual(["Agent Town"]);
    expect(names("宇宙")).toEqual(["智能体宇宙"]);
  });
  it("trims the query; nothing for an empty one; a limit", () => {
    expect(names("  docs ")).toEqual(["docs-site"]);
    expect(names("")).toEqual([]);
    expect(names("   ")).toEqual([]);
    expect(names("s", 2)).toHaveLength(2);
    expect(names("zzz")).toEqual([]);
  });
});
