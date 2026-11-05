// English interface (spec 2026-11-05 D): an English browser gets an English page — space, a city, the
// panels — and the switch turns it Chinese (and back) after a reload.
import { expect, test } from "@playwright/test";

test.use({ baseURL: "http://127.0.0.1:5180", locale: "en-US" });

const CJK = /[㐀-鿿　-〿＀-￯]/;
/** the page's text without the language switch (which offers "中文" on purpose) */
const text = (page: import("@playwright/test").Page) => page.evaluate(() => {
  const b = document.body.cloneNode(true) as HTMLElement;
  b.querySelector("[data-testid=lang]")?.remove();
  return b.innerText;
});

test("an English browser: no Chinese in space, in a city, in the history and the tour; the switch flips it", async ({ page }) => {
  test.setTimeout(360_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?demo=1");
  await page.waitForFunction(() => !!(window as any).__galaxyKeys && !!(window as any).__agentTown);
  await expect(page.getByTestId("tour")).toContainText("Welcome to Agent Universe");
  expect(await text(page)).not.toMatch(CJK);
  await page.getByTestId("tour-skip").click();
  const k: string = await page.evaluate(() => (window as any).__galaxyKeys[0]);
  await page.evaluate((key) => (window as any).__agentTown.enterCity(key), k);
  await expect(page.getByTestId("leave-city")).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  if (!(await page.getByTestId("history").isVisible())) await page.getByTestId("history-open").evaluate((b) => (b as HTMLButtonElement).click());
  await expect(page.getByTestId("history")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("legend").click();
  const city = await text(page);
  expect(city.match(new RegExp(`.{0,30}${CJK.source}.{0,30}`, "g")) ?? []).toEqual([]);
  // the switch: Chinese after a reload, then back
  await page.getByTestId("lang").click();
  await page.waitForFunction(() => !!(window as any).__galaxyKeys && !!(window as any).__agentTown);
  await expect(page.getByTestId("lang")).toHaveText("English");
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("zh-CN");
  await page.getByTestId("lang").click();
  await page.waitForFunction(() => !!(window as any).__galaxyKeys && !!(window as any).__agentTown);
  await expect(page.getByTestId("lang")).toHaveText("中文");
  expect(errors).toEqual([]);
});
