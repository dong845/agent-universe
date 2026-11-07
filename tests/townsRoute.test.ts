// POST /api/towns (spec 2026-11-07 D27 A2-A5): the owner names, hides and merges towns; saved to their own
// file, shown in the next world; a merge moves the requests on the next load.
import { mkdtempSync, readFileSync, realpathSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../packages/server/src/http.ts";
import { loadEventsAsync } from "../packages/server/src/load.ts";
import { writeClaudeSession, writeCodexRollout } from "./helpers/synthLogs.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "at-towns-")));
const tk = { input: 1, output: 2, cacheRead: 3, cacheWrite: 0 };
writeCodexRollout(join(root, "codex"), { sessionId: "c1", cwd: join(root, "alpha"), t0: 1e12, turns: [{ prompt: "one", tokens: tk }] });
writeCodexRollout(join(root, "codex"), { sessionId: "c2", cwd: join(root, "beta"), t0: 1e12 + 5000, turns: [{ prompt: "two", tokens: tk }] });
writeClaudeSession(join(root, "claude"), { sessionId: "h1", cwd: join(root, "alpha"), t0: 1e12 + 9000, turns: [{ prompt: "three", tokens: tk }] });
const townsFile = join(root, "agent-town", "towns.json");

let base = "";
let srv: ReturnType<typeof createServer>;
const ready = async () => { for (let i = 0; i < 200 && (srv.state().phase !== "ready" || srv.loading()); i++) await new Promise((r) => setTimeout(r, 20)); };
beforeAll(async () => {
  srv = createServer({
    load: (onProgress) => loadEventsAsync({ claudeRoot: join(root, "claude"), codexRoot: join(root, "codex"), cacheDir: null, onProgress, assign: { home: root, tempRoots: [] } }),
    staticDir: null,
    themesFile: join(root, "agent-town", "themes.json"),
    townsFile,
    settingsFile: join(root, "agent-town", "settings.json"),
    shareSecretFile: join(root, "agent-town", "share-secret"),
  });
  await new Promise<void>((r) => srv.server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(srv.server.address() as AddressInfo).port}`;
  await ready();
});
afterAll(() => srv.server.close());

type Town = { key: string; name: string; folderName?: string; hidden?: boolean; faction: string };
const world = async () => (await fetch(`${base}/api/world`)).json() as Promise<{ towns: Town[]; requests: { faction: string; projectId: string }[] }>;
const post = (body: unknown, headers: Record<string, string> = {}) => fetch(`${base}/api/towns`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const codex = async (end: string) => (await world()).towns.find((t) => t.faction === "codex" && t.key.endsWith(end))!;

describe("/api/towns", () => {
  it("names a town, and an empty name gives the folder's name back", async () => {
    const a = await codex("/alpha");
    expect((await post({ key: a.key, name: "  My app " })).status).toBe(204);
    expect(await codex("/alpha")).toMatchObject({ name: "My app", folderName: "alpha" });
    expect(JSON.parse(readFileSync(townsFile, "utf8")).names[a.key]).toBe("My app");
    expect((await post({ key: a.key, name: "" })).status).toBe(204);
    expect((await codex("/alpha")).name).toBe("alpha");
  });

  it("hides a town and shows it again; GET lists what is set", async () => {
    const b = await codex("/beta");
    expect((await post({ key: b.key, hidden: true })).status).toBe(204);
    expect((await codex("/beta")).hidden).toBe(true);
    expect((await (await fetch(`${base}/api/towns`)).json()).hidden).toEqual([b.key]);
    expect((await post({ key: b.key, hidden: false })).status).toBe(204);
    expect((await codex("/beta")).hidden).toBeUndefined();
  });

  it("merges a town into another of its side on the next load, and undoes it", async () => {
    const a = await codex("/alpha");
    const b = await codex("/beta");
    expect((await post({ key: a.key, merge: b.key })).status).toBe(204);
    await ready();
    let w = await world();
    expect(w.towns.some((t) => t.key === a.key)).toBe(false);
    expect(w.requests.filter((r) => `${r.faction}|${r.projectId}` === b.key)).toHaveLength(2);
    expect(w.towns.some((t) => t.faction === "claude-code" && t.key.endsWith("/alpha"))).toBe(true);
    expect((await (await fetch(`${base}/api/towns`)).json()).merge).toEqual({ [a.key]: b.key });
    expect((await post({ key: a.key, merge: null })).status).toBe(204);
    await ready();
    w = await world();
    expect(w.towns.some((t) => t.key === a.key)).toBe(true);
  });

  it("refuses bad bodies, unknown towns, other sides, itself, and a foreign page", async () => {
    const a = await codex("/alpha");
    const claude = (await world()).towns.find((t) => t.faction === "claude-code")!;
    expect((await post("{nope")).status).toBe(400);
    expect((await post("null")).status).toBe(400);
    expect((await post([1])).status).toBe(400);
    expect((await post({ key: "codex|/nowhere", name: "x" })).status).toBe(400);
    expect((await post({ key: a.key })).status).toBe(400);
    expect((await post({ key: a.key, name: 5 })).status).toBe(400);
    expect((await post({ key: a.key, merge: claude.key })).status).toBe(400);
    expect((await post({ key: a.key, merge: a.key })).status).toBe(400);
    expect((await post({ key: a.key, merge: "codex|/nowhere" })).status).toBe(400);
    expect((await post({ key: a.key, name: "x" }, { origin: "http://evil.example" })).status).toBe(403);
  });
});
