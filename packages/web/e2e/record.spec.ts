// Recording a city replay (spec 2026-11-01 C) on demo data: the dialog, the banner, share mode while it
// runs, labels painted into the frames, and a downloaded video.
import { expect, test } from "@playwright/test";
import { demoPayload } from "../../mock/src/world.ts";

const payload = demoPayload();
test.use({ baseURL: "http://127.0.0.1:5180" });

test("record a replay: project names kept, titles hidden by default, labels in the frames, a video file at the end", async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?demo=1&paused=1");
  await page.waitForFunction(() => !!(window as any).__galaxyKeys && !!(window as any).__agentTown);
  const k: string = await page.evaluate(() => (window as any).__galaxyKeys[0]);
  const rid: string = await page.evaluate((key) => (window as any).__agentTown.requestsOf(key)[0], k);
  await page.evaluate(([key, r]) => (window as any).__agentTown.select({ kind: "request", district: key, requestId: r }), [k, rid]);
  await page.getByTestId("city-replay").waitFor({ timeout: 30_000 });
  await page.getByTestId("city-replay").evaluate((b) => (b as HTMLButtonElement).click());
  await expect(page.getByTestId("replay-bar")).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press("Escape");
  await page.getByTestId("rec-open").evaluate((b) => (b as HTMLButtonElement).click());
  await expect(page.getByTestId("rec-dialog")).toBeVisible();
  // the recording ends with the replay or on 停止, whichever comes first: listen from the start
  const download = page.waitForEvent("download", { timeout: 180_000 });
  await page.getByTestId("rec-start").click();
  // the software renderer the tests use draws a city at a frame or two a second: the page answers slowly
  await expect(page.getByTestId("rec-banner")).toContainText("已隐藏请求标题", { timeout: 60_000 });
  expect(await page.evaluate(() => (window as any).__agentTown.shareOn())).toBe(true);
  const name = payload.towns.find((t) => t.key === k)!.name;
  // owner 2026-11-01: planets keep their project names in a recording; the request titles are hidden
  await expect.poll(() => page.evaluate(() => document.body.innerText), { timeout: 60_000 }).toContain(name);
  await expect(page.getByTestId("replay-bar")).not.toContainText("历史任务");
  // labels are being painted into the recorded frames
  await expect.poll(() => page.evaluate(() => (window as any).__recLabels?.() ?? 0), { timeout: 60_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(3000);
  const stop = page.getByTestId("rec-banner").getByRole("button", { name: "停止" });
  if (await stop.isVisible()) await stop.click().catch(() => {});
  const d = await download;
  expect(d.suggestedFilename()).toMatch(/^agent-town-.+-\d{4}-\d{2}-\d{2}\.(mp4|webm)$/);
  expect(d.suggestedFilename()).toContain(name);
  const path = await d.path();
  const { statSync } = await import("node:fs");
  expect(statSync(path!).size).toBeGreaterThan(10_000);
  await expect(page.getByTestId("rec-banner")).toHaveCount(0, { timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => document.body.innerText), { timeout: 60_000 }).toContain(name);
  expect(errors).toEqual([]);
});
