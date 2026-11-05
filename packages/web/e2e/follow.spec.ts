// Follow an agent (spec 2026-11-05 C1): a click on a robot makes the camera follow it and opens its card;
// Esc lets go; in share mode the card names no file or command.
import { expect, test } from "@playwright/test";

test.use({ baseURL: "http://127.0.0.1:5180" });

test("follow: click a robot → camera on it and its card; Esc lets go; share mode hides targets", async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem("agent-universe:tour-done", "1"));
  await page.goto("/?demo=1");
  await page.waitForFunction(() => !!(window as any).__galaxyLive && !!(window as any).__agentTown);
  const k: string = await page.evaluate(() => (window as any).__galaxyLive[0]);
  await page.evaluate((key) => (window as any).__agentTown.enterCity(key), k);
  await expect(page.getByTestId("leave-city")).toBeVisible({ timeout: 60_000 });
  // the main agent: it stays for the whole request (a subagent may leave mid-test)
  await page.waitForFunction(() => ((window as any).__robotSizes?.() ?? []).some((r: any) => r.kind === "main"), null, { timeout: 60_000 });
  const id: string = await page.evaluate(() => (window as any).__robotSizes().find((r: any) => r.kind === "main").id);
  await page.evaluate((r) => (window as any).__agentTown.clickRobot(r), id);
  await expect(page.getByTestId("follow-card")).toBeVisible();
  await expect(page.getByTestId("follow-card")).toContainText(/主代理|子代理/);
  // the camera has come to the robot (a smooth chase: a walking robot stays a step or two ahead)
  await expect.poll(async () => page.evaluate((r) => {
    const s = (window as any).__agentTown.state();
    const me = (window as any).__robotSizes().find((x: any) => x.id === r);
    return me && s.target ? Math.hypot(s.target.x - me.x, s.target.z - me.z) : 99;
  }, id), { timeout: 10_000 }).toBeLessThan(2.5);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("follow-card")).toHaveCount(0);
  // share mode: the card says what kind of work, never which file or command
  await page.evaluate(() => (window as any).__agentTown.setShare(true));
  await page.waitForFunction(() => (window as any).__agentTown.shareOn());
  await page.evaluate((r) => (window as any).__agentTown.clickRobot(r), id);
  await expect(page.getByTestId("follow-card")).toBeVisible();
  for (let i = 0; i < 6; i++) {
    expect(await page.getByTestId("follow-doing").innerText()).not.toMatch(/\/|\\|\.ts\b|\.py\b|npm |git /);
    await page.waitForTimeout(500);
  }
  expect(errors).toEqual([]);
});
