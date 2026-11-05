// The agents (spec 2026-11-05 A5): big enough to see in the default city view — a main agent at least
// 40 px tall on a 1440×900 page, a subagent at least 28 px — with one face and at most one prop showing.
import { expect, test } from "@playwright/test";

test.use({ baseURL: "http://127.0.0.1:5180" });

test("agents: big enough in the default city camera, one face each", async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?demo=1");
  await page.waitForFunction(() => !!(window as any).__galaxyLive && !!(window as any).__agentTown);
  const k: string = await page.evaluate(() => (window as any).__galaxyLive[0]);
  await page.evaluate((key) => (window as any).__agentTown.enterCity(key), k);
  await expect(page.getByTestId("leave-city")).toBeVisible({ timeout: 60_000 });
  await page.waitForFunction(() => ((window as any).__robotSizes?.() ?? []).some((r: any) => r.kind === "main"), null, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  const sizes: { id: string; kind: string; px: number; faces: number; props: number }[] = await page.evaluate(() => (window as any).__robotSizes());
  for (const r of sizes) {
    expect(r.px, `${r.kind} ${r.id}`).toBeGreaterThanOrEqual(r.kind === "main" ? 40 : 28);
    expect(r.faces, `${r.id} faces`).toBe(1);
    expect(r.props, `${r.id} props`).toBeLessThanOrEqual(r.kind === "main" ? 0 : 1);
  }
  expect(errors).toEqual([]);
});
