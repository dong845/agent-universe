// The history panel (owner 2026-11-01) on demo data: a town's requests as steps; choosing one stops the
// city at the moment that request finished, with facts from the logs; "回到现在" returns to now.
import { expect, test } from "@playwright/test";
import { demoPayload } from "../../mock/src/world.ts";

const payload = demoPayload();
test.use({ baseURL: "http://127.0.0.1:5180" });

test("history: steps oldest first, each stops the clock at its end, prev/next and ← →, back to now", async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?demo=1&paused=1");
  await page.waitForFunction(() => !!(window as any).__galaxyKeys && !!(window as any).__agentTown);
  const k: string = await page.evaluate(() => (window as any).__galaxyKeys[0]);
  const steps = payload.requests.filter((r) => `${r.faction}|${r.projectId}` === k && r.class !== "empty").sort((a, b) => a.endTs - b.endTs || a.startTs - b.startTs);
  expect(steps.length).toBeGreaterThan(1);
  await page.evaluate((key) => (window as any).__agentTown.enterCity(key), k);
  await expect(page.getByTestId("leave-city")).toBeVisible({ timeout: 60_000 });
  // a live town opens without it; the button opens it at the latest step
  if (!(await page.getByTestId("history").isVisible())) await page.getByTestId("history-open").evaluate((b) => (b as HTMLButtonElement).click());
  const panel = page.getByTestId("history");
  await expect(panel).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("history-step")).toHaveCount(steps.length);
  const abs = () => page.evaluate(() => (window as any).__agentTown.state().abs);
  await expect.poll(abs).toBe(steps[steps.length - 1].endTs);
  await page.getByTestId("history-step").first().evaluate((b) => (b as HTMLButtonElement).click());
  await expect.poll(abs).toBe(steps[0].endTs);
  await expect(page.getByTestId("history-facts")).toContainText(steps[0].title ?? "（无标题）");
  await expect(page.getByTestId("history-facts")).toContainText(`${steps[0].calls} 次`);
  await page.getByTestId("history-next").evaluate((b) => (b as HTMLButtonElement).click());
  await expect.poll(abs).toBe(steps[1].endTs);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(abs).toBe(steps[0].endTs);
  expect(await page.evaluate(() => (window as any).__agentTown.state().source)).toBe("demo");
  await page.getByTestId("history-close").evaluate((b) => (b as HTMLButtonElement).click());
  await expect(panel).toHaveCount(0);
  // back to the clock: the world is no longer pinned to a step
  expect(await page.evaluate(() => (window as any).__agentTown.state().historyAt)).toBeNull();
  expect(errors).toEqual([]);
});
