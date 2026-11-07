// Fixes from the D27 review (spec 2026-11-07): share mode keeps a renamed town's folder secret, a History
// step on a suburb points at its tiny house, and a merge can never be saved as a loop.
import { mkdtempSync, realpathSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import manifest from "../art/manifest.json" with { type: "json" };
import type { RequestRow } from "../packages/schema/src/payload.ts";
import type { TownRow } from "../packages/schema/src/towns.ts";
import { maskWorld } from "../packages/web/src/share/display.ts";
import { historySteps } from "../packages/web/src/city/history.ts";
import type { Manifest } from "../packages/web/src/v3/art.ts";
import { buildWorld25 } from "../packages/web/src/v3/world25Data.ts";
import { createServer } from "../packages/server/src/http.ts";
import { loadEventsAsync } from "../packages/server/src/load.ts";
import { writeCodexRollout } from "./helpers/synthLogs.ts";

const town = { key: "codex|/w/secret-client", faction: "codex", projectId: "/w/secret-client", name: "Project X", folderName: "secret-client", hidden: true, kind: "project", guildOf: [], theme: "craftsmen", counts: { produced: 60, investigation: 0, chat: 0, empty: 0 }, workCounts: {}, lastEditTs: null } as TownRow;
const req = (i: number): RequestRow => ({ requestId: `R${String(i).padStart(3, "0")}`, faction: "codex", projectId: "/w/secret-client", sessionId: "s", startTs: 1000 + i, endTs: 2000 + i, ok: true, class: "produced", productKind: "code", tokens: { input: i, output: 1, cacheRead: 0, cacheWrite: 0 }, calls: 1, fails: 0, spawns: 0, skills: [], topDir: "src", turns: 1, taskIds: [`T${i}`] });
const w = buildWorld25([town], Array.from({ length: 60 }, (_, i) => req(i)), manifest as Manifest);

describe("share mode", () => {
  it("a renamed town's folder name does not survive masking", () => {
    const m = maskWorld(w, { [town.key]: "Kepler-07c" }, false).towns.get(town.key)!;
    expect(m.name).toBe("Kepler-07c");
    // the key and projectId stay (masking keeps keys so nothing moves); nothing shown carries the folder
    const { key: _k, projectId: _p, ...shown } = m;
    expect(JSON.stringify(shown)).not.toContain("secret-client");
  });
});

describe("history steps on suburbs", () => {
  it("a finished piece in the suburbs is drawn — as a tiny house — not a ghost", () => {
    const layout = w.layouts.get(town.key)!;
    expect(layout.suburbs.length).toBeGreaterThan(0);
    const steps = historySteps(w, town.key);
    const sub = steps.find((s) => s.request.requestId === layout.suburbs[0].requestId)!;
    expect(sub).toMatchObject({ drawn: true, suburb: true });
    expect(steps.filter((s) => !s.drawn)).toEqual([]);
  });
});

describe("a merge that would close a loop", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "at-loop-")));
  const tk = { input: 1, output: 2, cacheRead: 3, cacheWrite: 0 };
  writeCodexRollout(join(root, "codex"), { sessionId: "c1", cwd: join(root, "alpha"), t0: 1e12, turns: [{ prompt: "one", tokens: tk }] });
  writeCodexRollout(join(root, "codex"), { sessionId: "c2", cwd: join(root, "beta"), t0: 1e12 + 5000, turns: [{ prompt: "two", tokens: tk }] });
  let srv: ReturnType<typeof createServer>;
  let base = "";
  const ready = async () => { for (let i = 0; i < 200 && (srv.state().phase !== "ready" || srv.loading()); i++) await new Promise((r) => setTimeout(r, 20)); };
  beforeAll(async () => {
    srv = createServer({ load: async (onProgress) => { await new Promise((r) => setTimeout(r, 300)); return loadEventsAsync({ claudeRoot: join(root, "claude"), codexRoot: join(root, "codex"), cacheDir: null, onProgress, assign: { home: root, tempRoots: [] } }); }, staticDir: null, themesFile: join(root, "at", "themes.json"), townsFile: join(root, "at", "towns.json"), settingsFile: join(root, "at", "settings.json"), shareSecretFile: join(root, "at", "secret") });
    await new Promise<void>((r) => srv.server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(srv.server.address() as AddressInfo).port}`;
    await ready();
  });
  afterAll(() => srv.server.close());
  it("is refused, and the first merge stays", async () => {
    const towns: { key: string }[] = (await (await fetch(`${base}/api/world`)).json()).towns;
    const a = towns.find((t) => t.key.endsWith("/alpha"))!.key, b = towns.find((t) => t.key.endsWith("/beta"))!.key;
    const post = (body: unknown) => fetch(`${base}/api/towns`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    // b into a, then at once (before the reload, while both towns still exist) a into b: a loop
    expect((await post({ key: b, merge: a })).status).toBe(204);
    expect((await post({ key: a, merge: b })).status).toBe(400);
    await ready();
    expect((await (await fetch(`${base}/api/towns`)).json()).merge).toEqual({ [b]: a });
  });
});
