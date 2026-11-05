// Answering from the page (spec 2026-11-05 D26 B): a hook waiting on a server of its own; the page shows
// the question in 需要你, the choice made there is what the hook gets back.
import { expect, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("a question waiting in a hook: shown in 需要你, chosen on the page, sent back", async ({ page }) => {
  test.slow();
  const tmp = mkdtempSync(join(tmpdir(), "at-decide-"));
  for (const d of ["claude", "codex"]) mkdirSync(join(tmp, d));
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  const port = 5198;
  const server: ChildProcess = spawn(process.execPath, [join(root, "scripts/serve.ts"), "--port", String(port), "--claude", join(tmp, "claude"), "--codex", join(tmp, "codex"), "--no-cache", "--port-file", join(tmp, "port")], { cwd: root, stdio: "ignore", env: { ...process.env, HOME: tmp } });
  try {
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/api/status`)).ok) break; } catch { /* starting */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => localStorage.setItem("agent-universe:tour-done", "1"));
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(() => !!(window as any).__galaxyKeys, null, { timeout: 90_000 });
    // the page's first heartbeat: a hook is held only while a page is watching
    await expect.poll(async () => (await (await fetch(`http://127.0.0.1:${port}/api/status`)).json()).watching, { timeout: 30_000 }).toBe(true);
    const hook = {
      session_id: "e2e-session", tool_name: "AskUserQuestion", cwd: "/synthetic/e2e-project",
      tool_input: { questions: [{ question: "Pick a color", header: "Color", multiSelect: false, options: [{ label: "Red", description: "warm" }, { label: "Blue", description: "cool" }] }] },
    };
    const reply = fetch(`http://127.0.0.1:${port}/api/ask?src=claude`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(hook) }).then((r) => r.text());
    // a held question survives the page being busy: wait well past the old heartbeat window
    await page.waitForTimeout(30_000);
    // clicked from inside the page: the software renderer the tests use draws so few frames that
    // Playwright's "stable" check can time out (as in world.spec)
    const click = (l: import("@playwright/test").Locator) => l.evaluate((el) => (el as HTMLElement).click());
    await page.getByTestId("needs-decide").waitFor({ timeout: 20_000 });
    await click(page.getByTestId("needs-decide"));
    const panel = page.getByTestId("decision");
    await expect(panel).toContainText("Pick a color");
    await expect(page.getByTestId("decision-send")).toBeDisabled();
    await click(panel.getByTestId("decision-option").nth(1));
    await expect(page.getByTestId("decision-send")).toBeEnabled();
    await click(page.getByTestId("decision-send"));
    const out = JSON.parse(await reply);
    expect(out.hookSpecificOutput.decision).toMatchObject({ behavior: "allow", updatedInput: { answers: { "Pick a color": "Blue" } } });
    await expect(panel).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    server.kill();
  }
});
