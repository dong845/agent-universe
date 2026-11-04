// Share mode (spec 2026-11-01 B1/B2): the page itself shows code names and our own emblems, so what is
// recorded is what the owner sees. Demo data: the demo's own town names and titles are the "secrets".
import { expect, test } from "@playwright/test";
import { demoPayload } from "../../mock/src/world.ts";

const payload = demoPayload();
test.use({ baseURL: "http://127.0.0.1:5180" });

const pageText = (page: import("@playwright/test").Page) => page.evaluate(() => document.body.innerText);

test("share mode hides every town name, title and folder, swaps the emblems, and switches back", async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?demo=1&paused=1");
  await page.waitForFunction(() => !!(window as any).__galaxyKeys && !!(window as any).__agentTown);
  await page.waitForFunction(() => (window as any).__agentTownFlying && !(window as any).__agentTownFlying(), null, { timeout: 90_000 });
  await page.waitForTimeout(2500);
  const names = [...new Set(payload.towns.map((t) => t.name))];
  const before = await pageText(page);
  expect(names.filter((n) => before.includes(n)).length).toBeGreaterThan(0);
  // the official marks are not in the repository (spec 2026-11-03 C2): a page without a download draws the neutral ones
  expect(await page.evaluate(() => (window as any).__galaxyEmblems())).toEqual(["neutral"]);

  await page.evaluate(() => (window as any).__agentTown.setShare(true));
  await page.waitForTimeout(1500);
  const text = await pageText(page);
  for (const n of names) expect(text, n).not.toContain(n);
  expect(await page.evaluate(() => (window as any).__galaxyEmblems())).toEqual(["neutral"]);
  // inside a city: street names come from the owner's folders
  const k: string = await page.evaluate(() => (window as any).__galaxyKeys[0]);
  await page.evaluate((key) => (window as any).__agentTown.enterCity(key), k);
  await page.waitForTimeout(3000);
  const city = await pageText(page);
  for (const n of names) expect(city, n).not.toContain(n);
  for (const d of ["docs", "src", "scripts", "assets", "config", "test"]) expect(city, d).not.toContain(`${d} 街`);
  // the diary cannot open in share mode
  const rid: string = await page.evaluate((key) => (window as any).__agentTown.requestsOf(key)[0], k);
  await page.evaluate(([key, r]) => (window as any).__agentTown.select({ kind: "request", district: key, requestId: r }), [k, rid]);
  await expect(page.getByTestId("diary")).toHaveCount(0);

  await page.evaluate(() => (window as any).__agentTown.setShare(false));
  await page.waitForTimeout(1500);
  const after = await pageText(page);
  expect(names.filter((n) => after.includes(n)).length).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as any).__galaxyEmblems())).toEqual(["neutral"]);
  expect(errors).toEqual([]);
});
