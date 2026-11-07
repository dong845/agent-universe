// Town names and a city that steps aside (spec 2026-11-07 D27 A2/A3/B2), on a server of its own with
// synthetic logs and a throwaway home: rename in Overview, hide from space and show again from
// Settings, and the city's picture moves left while the panel is open.
import { expect, test } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeClaudeSession } from "../../../tests/helpers/synthLogs.ts";

test("rename, hide and show a town; the city steps aside for its panel", async ({ page }) => {
  test.slow();
  const tmp = mkdtempSync(join(tmpdir(), "at-towns-e2e-"));
  for (const d of ["claude", "codex"]) mkdirSync(join(tmp, d));
  const tk = { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 };
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  // the projects may not live in a temp folder (work there belongs to the field camp): git-ignored test-results
  mkdirSync(join(root, "packages/web/test-results"), { recursive: true });
  const work = mkdtempSync(join(root, "packages/web/test-results", "towns-work-"));
  for (const [i, name] of ["alpha", "beta"].entries()) {
    const cwd = join(work, name);
    mkdirSync(join(cwd, "src"), { recursive: true });
    writeFileSync(join(cwd, "package.json"), "{}");
    // its own repository, so it is a project of its own (not part of the repository it sits in)
    execFileSync("git", ["init", "-q", cwd]);
    writeClaudeSession(join(tmp, "claude"), {
      sessionId: `s-${name}`, cwd, t0: Date.now() - 86_400_000 * (3 - i),
      turns: Array.from({ length: 5 }, (_, k) => ({ prompt: `make part ${k}`, tools: [{ name: "Write", input: { file_path: join(cwd, "src", `f${k}.ts`), content: "x" } }], tokens: tk })),
    });
  }
  const port = 5197;
  const base = `http://127.0.0.1:${port}`;
  const server: ChildProcess = spawn(process.execPath, [join(root, "scripts/serve.ts"), "--port", String(port), "--claude", join(tmp, "claude"), "--codex", join(tmp, "codex"), "--no-cache", "--port-file", join(tmp, "port")], { cwd: root, stdio: "ignore", env: { ...process.env, HOME: tmp } });
  try {
    for (let i = 0; i < 100; i++) {
      try { if ((await (await fetch(`${base}/api/status`)).json()).phase === "ready") break; } catch { /* starting */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => localStorage.setItem("agent-universe:tour-done", "1"));
    await page.goto(`${base}/`);
    await page.waitForFunction(() => ((window as any).__galaxyKeys ?? []).length >= 2, null, { timeout: 90_000 });
    const keys: string[] = await page.evaluate(() => (window as any).__galaxyKeys);
    const alpha = keys.find((k) => k.endsWith("/alpha"))!;
    expect(alpha).toBeTruthy();
    const click = (l: import("@playwright/test").Locator) => l.evaluate((el) => (el as HTMLElement).click());

    // into alpha's city: the Overview opens and the picture steps aside for it
    await page.evaluate((k) => (window as any).__agentTown.enterCity(k), alpha);
    await page.getByTestId("overview").waitFor({ timeout: 30_000 });
    await expect.poll(() => page.evaluate(() => (window as any).__cityShift?.() ?? 0), { timeout: 20_000 }).toBeGreaterThan(150);

    // rename: the name shows in the panel, and the owner's file keeps it
    await click(page.getByTestId("town-rename"));
    await page.getByTestId("town-name-input").fill("Renamed app");
    await page.getByTestId("town-name-input").press("Enter");
    await expect(page.getByTestId("town-name")).toContainText("Renamed app", { timeout: 20_000 });
    expect(JSON.parse(readFileSync(join(tmp, ".agent-town", "towns.json"), "utf8")).names[alpha]).toBe("Renamed app");

    // hide: no planet any more, but the city stays open; Settings lists it and brings it back
    await click(page.getByTestId("town-hide"));
    await expect.poll(() => page.evaluate((k) => (window as any).__galaxyKeys.includes(k), alpha), { timeout: 20_000 }).toBe(false);
    await expect(page.getByTestId("overview")).toBeVisible();
    await click(page.getByTestId("settings"));
    await expect(page.getByTestId("settings-towns")).toContainText("Renamed app", { timeout: 20_000 });
    await click(page.getByTestId("town-show"));
    await expect.poll(() => page.evaluate((k) => (window as any).__galaxyKeys.includes(k), alpha), { timeout: 20_000 }).toBe(true);
    await click(page.getByTestId("settings"));

    // closing the panel gives the city its middle back
    await click(page.getByTestId("overview-close"));
    await expect.poll(() => page.evaluate(() => (window as any).__cityShift?.() ?? -1), { timeout: 20_000 }).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    server.kill();
  }
});
