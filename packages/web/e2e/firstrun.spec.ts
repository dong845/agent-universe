// First run (spec 2026-11-03 C4): the tour on a first visit, and the demo world with a plain note when
// the server finds no logs at all.
import { expect, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("the tour: shown on a first visit, skippable, not shown again", async ({ page }) => {
  test.slow();
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

test("the guided tour: each step goes where it explains, and ends inviting a click (spec 2026-11-05 B1)", async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5180/?demo=1");
  await page.waitForFunction(() => !!(window as any).__galaxyKeys && !!(window as any).__agentTown);
  const key: string = await page.evaluate(() => (window as any).__galaxyKeys[0]);
  const tour = () => page.evaluate(() => (window as any).__agentTown.tour());
  const st = () => page.evaluate(() => (window as any).__agentTown.state());
  const next = () => page.getByTestId("tour-next").click();
  await expect(page.getByTestId("tour")).toHaveAttribute("data-step", "welcome");
  await expect(page.getByTestId("tour")).toContainText("演示世界");
  await next();
  await expect(page.getByTestId("tour")).toHaveAttribute("data-step", "stars");
  await next();
  await expect.poll(async () => (await st()).focus).toBe(key);
  await next();
  await expect.poll(async () => (await st()).city, { timeout: 30_000 }).toBe(key);
  await next();
  await expect(page.getByTestId("tour")).toHaveAttribute("data-step", "robot");
  await expect.poll(async () => (await tour()).follow, { timeout: 30_000 }).not.toBeNull();
  await expect(page.getByTestId("follow-card")).toBeVisible();
  await next();
  await expect(page.getByTestId("tour")).toHaveAttribute("data-step", "panels");
  await expect(page.locator(".tour-glow")).toHaveCount(1);
  expect((await tour()).follow).toBeNull();
  await next();
  await expect.poll(async () => (await st()).city).toBeNull();
  await page.getByTestId("tour-done").click();
  await expect(page.getByTestId("tour")).toHaveCount(0);
  expect((await tour()).invite).toBe(true);
  // entering any city answers the invitation
  await page.evaluate((k) => (window as any).__agentTown.enterCity(k), key);
  await expect.poll(async () => (await tour()).invite).toBe(false);
  // the settings' replay starts it over
  await page.evaluate(() => (window as any).__agentTown.enterCity(null));
  await page.evaluate(() => (window as any).__agentTown.startTour());
  await expect(page.getByTestId("tour")).toHaveAttribute("data-step", "welcome");
  expect(errors).toEqual([]);
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
    // a card of its own (spec 2026-11-05 B3): never over the top bar, the shell meter or the legend
    const card = page.getByTestId("empty-logs");
    await expect(card).toContainText("没有找到日志");
    await expect(card).toContainText(join(tmp, "claude"));
    const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
    const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    const c = await box("[data-testid=empty-logs]");
    for (const sel of ["[data-testid=hud]", ".g-meter", "[data-testid=legend]", "[data-testid=source-badge]"]) expect(overlap(c, await box(sel)), sel).toBe(false);
    await page.getByTestId("empty-logs-close").click();
    await expect(card).toHaveCount(0);
    expect((await page.evaluate(() => (window as any).__galaxyKeys)).length).toBeGreaterThan(0);
  } finally {
    server.kill();
  }
});

test("no stat that never has a value, and a city opens with its legend folded (spec 2026-11-05 B2/B3)", async ({ page }) => {
  test.slow();
  await page.addInitScript(() => localStorage.setItem("agent-universe:tour-done", "1"));
  await page.goto("http://127.0.0.1:5180/?demo=1&paused=1");
  await page.waitForFunction(() => !!(window as any).__galaxyKeys && !!(window as any).__agentTown);
  expect(await page.evaluate(() => document.body.innerText)).not.toContain("等效花费");
  const k: string = await page.evaluate(() => (window as any).__galaxyKeys[0]);
  await page.evaluate((key) => (window as any).__agentTown.enterCity(key), k);
  await expect(page.getByTestId("leave-city")).toBeVisible({ timeout: 60_000 });
  expect(await page.evaluate(() => document.body.innerText)).not.toContain("等效花费");
  const legend = page.getByTestId("legend");
  await expect(legend).toHaveClass(/g-legend-min/);
  // opened by the user, it stays open the next time
  await legend.click();
  await expect(legend).not.toHaveClass(/g-legend-min/);
  await page.evaluate(() => (window as any).__agentTown.enterCity(null));
  await page.evaluate((key) => (window as any).__agentTown.enterCity(key), k);
  await expect(page.getByTestId("leave-city")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("legend")).not.toHaveClass(/g-legend-min/);
});
