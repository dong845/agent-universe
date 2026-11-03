// The official marks are not in the repository (spec 2026-11-03 C2): a switch downloads them from
// Wikimedia Commons into the owner's own folder, for this machine only. No network here: a fake fetch.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { downloadLogos, LOGO_SOURCES, readLogos, removeLogos } from "../packages/server/src/logos.ts";

const SVG = (d: string) => `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="${d}"/></svg>`;
const fakeFetch = (bodies: Record<string, string>) => (async (url: string) => {
  const body = bodies[url];
  return { ok: body !== undefined, status: body === undefined ? 404 : 200, text: async () => body ?? "" };
}) as unknown as typeof fetch;

describe("official marks: a local download", () => {
  it("nothing until downloaded; downloaded marks are read back; removing deletes them", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "at-logos-")), "logos");
    expect(readLogos(dir)).toEqual({});
    const r = await downloadLogos(dir, fakeFetch({ [LOGO_SOURCES.claude]: SVG("M0 0L5 5"), [LOGO_SOURCES.openai]: SVG("M1 1L4 4") }));
    expect(r.saved.sort()).toEqual(["claude", "openai"]);
    expect(readLogos(dir).claude).toContain("M0 0L5 5");
    removeLogos(dir);
    expect(readLogos(dir)).toEqual({});
  });
  it("refuses anything that is not a small SVG with a path, and writes nothing then", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "at-logos-")), "logos");
    await expect(downloadLogos(dir, fakeFetch({ [LOGO_SOURCES.claude]: "<html>nope</html>", [LOGO_SOURCES.openai]: SVG("M1 1") }))).rejects.toThrow(/SVG/);
    await expect(downloadLogos(dir, fakeFetch({ [LOGO_SOURCES.claude]: SVG("M1 1") + "<script>x</script>", [LOGO_SOURCES.openai]: SVG("M1 1") }))).rejects.toThrow(/script/);
    await expect(downloadLogos(dir, fakeFetch({}))).rejects.toThrow(/404/);
    expect(existsSync(join(dir, "claude.svg"))).toBe(false);
  });
  it("the sources are Wikimedia Commons", () => {
    for (const u of Object.values(LOGO_SOURCES)) expect(u).toMatch(/^https:\/\/commons\.wikimedia\.org\//);
  });
});

describe("the repository carries no official marks", () => {
  it("no logo files and no model built from them are tracked", () => {
    const files = execFileSync("git", ["ls-files"], { cwd: join(import.meta.dirname, ".."), encoding: "utf8" }).split("\n");
    expect(files.filter((f) => f.startsWith("art/logos/") || f.endsWith("emblems.glb") || f.endsWith("models/emblems.py"))).toEqual([]);
  });
  it("the page's code does not import them", () => {
    const src = readFileSync(join(import.meta.dirname, "../packages/web/src/galaxy/emblem.ts"), "utf8");
    expect(src).not.toMatch(/art\/logos|\.svg\?raw/);
  });
});
void writeFileSync;

describe("the /api/logos switch", () => {
  it("downloads, reports, removes", async () => {
    const { createServer } = await import("../packages/server/src/http.ts");
    const dir = join(mkdtempSync(join(tmpdir(), "at-logos-")), "logos");
    const s = createServer({ load: async () => ({ events: [], requestOf: new Map(), mtimes: new Map() }) as never, staticDir: null, themesFile: join(dir, "..", "t.json"), logosDir: dir, logoFetch: fakeFetch({ [LOGO_SOURCES.claude]: SVG("M0 0"), [LOGO_SOURCES.openai]: SVG("M1 1") }) });
    await new Promise<void>((r) => s.server.listen(0, "127.0.0.1", r));
    const b = `http://127.0.0.1:${(s.server.address() as { port: number }).port}`;
    expect(await (await fetch(`${b}/api/logos`)).json()).toEqual({});
    expect((await fetch(`${b}/api/logos`, { method: "POST", body: JSON.stringify({ on: true }) })).status).toBe(200);
    expect(Object.keys(await (await fetch(`${b}/api/logos`)).json()).sort()).toEqual(["claude", "openai"]);
    await fetch(`${b}/api/logos`, { method: "POST", body: JSON.stringify({ on: false }) });
    expect(await (await fetch(`${b}/api/logos`)).json()).toEqual({});
    s.server.close();
  });
});
