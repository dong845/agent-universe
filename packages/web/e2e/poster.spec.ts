// The review poster (spec 2026-11-05 C3): a 1080×1350 PNG named for its period.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test.use({ baseURL: "http://127.0.0.1:5180" });

test("poster: pick a period, save a 1080×1350 PNG named for it", async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem("agent-universe:tour-done", "1"));
  await page.goto("/?demo=1&paused=1");
  await page.waitForFunction(() => !!(window as any).__galaxyKeys && !!(window as any).__agentTown);
  await page.getByTestId("poster-open").click();
  await expect(page.getByTestId("poster-dialog")).toBeVisible();
  await page.getByTestId("poster-month").click();
  // share mode is left again once the background is taken
  await expect.poll(() => page.evaluate(() => (window as any).__agentTown.shareOn())).toBe(false);
  const download = page.waitForEvent("download");
  await page.getByTestId("poster-save").click();
  const d = await download;
  expect(d.suggestedFilename()).toMatch(/^agent-universe-review-month-\d{4}-\d{2}-\d{2}\.png$/);
  const png = readFileSync((await d.path())!);
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1350]);
  expect(errors).toEqual([]);
});
