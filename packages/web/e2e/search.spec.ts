// Find a project by name (spec 2026-11-05 B3): `/` focuses the box, Enter flies there, Enter again enters.
import { expect, test } from "@playwright/test";
import { demoPayload } from "../../mock/src/world.ts";

test.use({ baseURL: "http://127.0.0.1:5180" });

test("search: / to focus, type, Enter flies to the planet, Enter again opens its city, Esc clears", async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem("agent-universe:tour-done", "1"));
  await page.goto("/?demo=1&paused=1");
  await page.waitForFunction(() => !!(window as any).__galaxyKeys && !!(window as any).__agentTown);
  const key: string = await page.evaluate(() => (window as any).__galaxyKeys[0]);
  const town = demoPayload().towns.find((t) => `${t.faction}|${t.projectId}` === key)!;
  await page.keyboard.press("/");
  await expect(page.getByTestId("search")).toBeFocused();
  await page.keyboard.type(town.name.slice(0, 4));
  await expect(page.getByTestId("search-hit").first()).toBeVisible();
  // pick the hit with the exact name (several demo towns can share a name across the two stars)
  const hits = page.getByTestId("search-hit");
  const n = await hits.count();
  let idx = -1;
  for (let i = 0; i < n; i++) if ((await hits.nth(i).innerText()).trim() === town.name && idx < 0) idx = i;
  expect(idx).toBeGreaterThanOrEqual(0);
  for (let i = 0; i < idx; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const focus = await page.evaluate(() => (window as any).__agentTown.state().focus);
  expect(focus).toBe(key);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("leave-city")).toBeVisible({ timeout: 60_000 });
  expect(await page.evaluate(() => (window as any).__agentTown.state().city)).toBe(focus);
  await page.evaluate(() => (window as any).__agentTown.enterCity(null));
  await page.getByTestId("search").fill("zzzz-nothing");
  await expect(page.getByTestId("search-box")).toContainText("没有这个名字的项目");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("search")).toHaveValue("");
  expect(errors).toEqual([]);
});
