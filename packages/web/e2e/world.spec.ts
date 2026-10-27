// The picture follows the data: every check reads the rendered page and compares it with values
// computed here, independently, from the same simulated events.
import { expect, test, type Page } from "@playwright/test";
import { worldScenario } from "../../mock/src/world.ts";
import { formatCount } from "../../schema/src/aggregate.ts";

const events = worldScenario();
// playback zero is the first live event: the demo task's start
const t0 = Math.min(...events.filter((e) => e.raw.file === "demo").map((e) => e.ts));
const PRIMARY = "claude-code|/demo/web-shop";
/** total tokens of every model call up to playback time t, summed here without the ledger */
function totalUpTo(t: number, pred = (_e: (typeof events)[number]) => true): number {
  return events
    .filter((e) => e.kind === "model_call" && e.ts - t0 <= t && pred(e))
    // the HUD counts the whole world; the site card only this task
    .reduce((n, e) => n + e.tokens!.input + e.tokens!.output + e.tokens!.cacheRead + e.tokens!.cacheWrite, 0);
}

/** opens flown into the primary town (or the whole world) and waits for the camera to arrive */
async function open(page: Page, errors: string[], focus: "primary" | "world" = "primary") {
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(focus === "primary" ? "/?paused=1&focus=primary" : "/?paused=1");
  await page.waitForFunction(() => !!(window as any).__agentTown);
  if (focus === "primary") await page.waitForSelector(`.label[data-label="b-library"][data-district="${PRIMARY}"]`, { state: "visible", timeout: 20_000 });
  else await page.waitForSelector(".banner", { state: "visible", timeout: 20_000 });
  await page.waitForTimeout(1500); // the camera flight settles
}
const at = (page: Page, t: number) => page.evaluate((t) => { (window as any).__agentTown.setTime(t); }, t);
const snap = (page: Page) => page.evaluate(() => (window as any).__agentTown.snapshot());

test.use({ baseURL: "http://127.0.0.1:5180" });

test("loads and scrubs the whole replay without console errors", async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  for (let t = 0; t <= 57_000; t += 1500) {
    await at(page, t);
    await page.waitForTimeout(40);
  }
  expect(errors).toEqual([]);
});

test("shows all twelve place labels inside the window", async ({ page }) => {
  await open(page, []);
  await page.waitForTimeout(300);
  const boxes = await page.$$eval(`.labels .label[data-district="${PRIMARY}"]`, (els) => els.map((e) => ({ id: (e as HTMLElement).dataset.label, r: e.getBoundingClientRect() })));
  expect(boxes.map((b) => b.id).sort()).toEqual(
    ["b-control", "b-council", "b-embassy", "b-forge", "b-library", "b-port", "b-studio", "b-training", "b-workshop", "booth", "hall", "warehouse"],
  );
  for (const b of boxes) {
    expect(b.r.x, b.id).toBeGreaterThan(0);
    expect(b.r.y, b.id).toBeGreaterThan(0);
    expect(b.r.x + b.r.width, b.id).toBeLessThan(1440);
    expect(b.r.y + b.r.height, b.id).toBeLessThan(900);
  }
});

test("no two labels overlap while both subagents work", async ({ page }) => {
  await open(page, []);
  for (const t of [9_300, 12_000, 16_800]) {
    await at(page, t);
    await page.waitForTimeout(200);
    const r = await page.$$eval(".labels > div", (els) =>
      els.filter((e) => getComputedStyle(e).visibility === "visible").map((e) => ({ id: (e as HTMLElement).dataset.label, ...e.getBoundingClientRect().toJSON() })));
    for (const a of r)
      for (const b of r) {
        if (a.id! >= b.id!) continue;
        const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        expect(overlap, `${a.id} overlaps ${b.id} at ${t} ms`).toBe(false);
      }
  }
});

test("site states appear exactly when the events say", async ({ page }) => {
  await open(page, []);
  const s = (t: number) => at(page, t).then(() => snap(page));
  expect((await s(15_900)).smoke).toBe(false); // the subagent's test fails at 16.0 s
  expect((await s(16_100)).smoke).toBe(true);
  expect((await s(37_700)).cloud).toBe(false); // third edit of client.ts lands at 37.8 s
  expect((await s(37_900)).cloud).toBe(true);
  const passed = await s(42_800); // passing test at 42.7 s clears both
  expect(passed.smoke || passed.cloud).toBe(false);
  expect((await s(54_900)).roof).toBe(false);
  const done = await s(57_000);
  expect(done.roof).toBe(true);
  expect(done.floors).toBe(6); // four main edits + two merged subagents
  expect(done.scaffolds).toEqual([]);
  expect((await s(9_300)).scaffolds.sort()).toEqual(["agent-scout", "agent-tests"]);
});

test("the HUD total equals the sum of model calls so far", async ({ page }) => {
  await open(page, []);
  for (const t of [1_400, 1_600, 20_000, 57_000]) {
    await at(page, t);
    await expect(page.getByTestId("hud-total")).toHaveText(formatCount(totalUpTo(t)));
  }
});

test("the site card shows the task total and the subagent subtotal", async ({ page }) => {
  await open(page, []);
  const t = 38_600;
  await at(page, t);
  await page.evaluate((district) => (window as any).__agentTown.hover({ kind: "site", district }, 700, 300), PRIMARY);
  const card = page.getByTestId("hover-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("测试失败中");
  const task = events.find((e) => e.raw.file === "demo" && e.kind === "task_start")!.taskId;
  await expect(card).toContainText(`合计 token${formatCount(totalUpTo(t, (e) => e.taskId === task))}`);
  await expect(card).toContainText(`其中子代理${formatCount(totalUpTo(t, (e) => e.taskId === task && e.agentId !== "main"))}`);
  await page.evaluate(() => (window as any).__agentTown.hover(null));
  await expect(card).toBeHidden();
});

test("a real mouse hover over a figure opens its card", async ({ page }) => {
  await open(page, []);
  await at(page, 46_500); // the commander waits at the hall with a raised hand
  // project the commander's position to the screen with the page's own camera
  const p = await page.evaluate(() => {
    const s = (window as any).__agentTown.snapshot();
    const pos = s.actors.find((a: any) => a.id === "main").pos;
    return { x: s.origin.x + pos.x, z: s.origin.z + pos.z };
  });
  const xy = await page.evaluate((p) => (window as any).__agentTown.toScreen(p.x, 1.2, p.z), p);
  await page.mouse.move(xy.x, xy.y);
  const card = page.getByTestId("hover-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("指挥官");
});

test("the canvas actually draws the town", async ({ page }) => {
  await open(page, []);
  await at(page, 38_600);
  await page.waitForTimeout(300);
  const png = await page.locator("canvas").screenshot();
  expect(png.byteLength).toBeGreaterThan(60_000); // a blank or single-colour canvas compresses to a few kB
});

test.describe("the world", () => {
  test("shows every town and both capitals inside the window from afar", async ({ page }) => {
    await open(page, [], "world");
    const boxes = await page.$$eval(".banner", (els) =>
      els.filter((e) => getComputedStyle(e).visibility === "visible").map((e) => ({ id: (e as HTMLElement).dataset.label, r: e.getBoundingClientRect().toJSON() })));
    expect(boxes.filter((b) => b.id!.startsWith("town-"))).toHaveLength(13);
    expect(boxes.filter((b) => b.id!.startsWith("capital-"))).toHaveLength(2);
    for (const b of boxes) {
      expect(b.r.x, b.id).toBeGreaterThan(0);
      expect(b.r.x + b.r.width, b.id).toBeLessThan(1440);
      expect(b.r.y, b.id).toBeGreaterThan(0);
      expect(b.r.y + b.r.height, b.id).toBeLessThan(900);
    }
    // no building labels while the whole world is on screen
    expect(await page.$$eval(".labels .label", (els) => els.filter((e) => getComputedStyle(e).visibility === "visible").length)).toBe(0);
  });

  test("shows the cross-faction bridge: its first crossing is in the history, before playback zero", async ({ page }) => {
    await open(page, [], "world");
    await at(page, 0);
    await expect(page.locator('[data-label="bridge"]')).toHaveCount(1);
    const first = await page.evaluate(() => (window as any).__agentTown.world().bridges[0].at);
    expect(first).toBeLessThan(t0);
  });

  test("double-clicking a town flies there and draws it in full", async ({ page }) => {
    await open(page, [], "world");
    const key = "codex|/demo/cli-tools";
    const o = await page.evaluate((key) => (window as any).__agentTown.world().districts.find((d: any) => d.key === key).origin, key);
    const xy = await page.evaluate((o) => (window as any).__agentTown.toScreen(o.x + 3, 0, o.z + 3), o);
    await page.mouse.dblclick(xy.x, xy.y);
    await expect.poll(() => page.evaluate(() => (window as any).__agentTown.snapshot().focus)).toBe(key);
    await expect.poll(() => page.evaluate(() => (window as any).__agentTown.snapshot().detail), { timeout: 10_000 }).toContain(key);
    await expect(page.locator(`.label[data-label="b-forge"][data-district="${key}"]`)).toBeVisible({ timeout: 10_000 });
  });
});
