// First run (spec 2026-11-03 C4): the tour on a first visit, and the demo world with a plain note when
// the server finds no logs at all.
import { expect, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("the tour: shown on a first visit, skippable, not shown again", async ({ page }) => {
  await page.goto("http://127.0.0.1:5180/?demo=1&paused=1");
  await page.waitForFunction(() => !!(window as any).__agentTown);
  const tour = page.getByTestId("tour");
  await expect(tour).toContainText("欢迎来到智能体宇宙");
  await page.getByTestId("tour-next").click();
  await expect(tour).toContainText("两颗恒星");
  await page.getByTestId("tour-skip").click();
  await expect(tour).toHaveCount(0);
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__agentTown);
  await page.waitForTimeout(500);
  await expect(page.getByTestId("tour")).toHaveCount(0);
});

test("no logs found: the demo world, saying where the logs would be", async ({ page }) => {
  test.slow();
  const tmp = mkdtempSync(join(tmpdir(), "at-empty-"));
  for (const d of ["claude", "codex"]) mkdirSync(join(tmp, d));
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  const server: ChildProcess = spawn(process.execPath, [join(root, "scripts/serve.ts"), "--port", "5196", "--claude", join(tmp, "claude"), "--codex", join(tmp, "codex"), "--no-cache", "--port-file", join(tmp, "port")], { cwd: root, stdio: "ignore" });
  try {
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch("http://127.0.0.1:5196/api/status")).ok) break; } catch { /* starting */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    await page.goto("http://127.0.0.1:5196/");
    await page.waitForFunction(() => !!(window as any).__galaxyKeys, null, { timeout: 90_000 });
    const badge = page.getByTestId("source-badge");
    await expect(badge).toContainText("没有找到日志");
    await expect(badge).toContainText(join(tmp, "claude"));
    expect((await page.evaluate(() => (window as any).__galaxyKeys)).length).toBeGreaterThan(0);
  } finally {
    server.kill();
  }
});
