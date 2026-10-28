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
  await page.goto(focus === "primary" ? "/?demo=1&paused=1&focus=primary" : "/?demo=1&paused=1");
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
  test("from afar: every town banner is shown or gives way to a bigger town it would cover; none overlap", async ({ page }) => {
    await open(page, [], "world");
    const all = await page.$$eval(".banner", (els) =>
      els.map((e) => ({ id: (e as HTMLElement).dataset.label!, visible: getComputedStyle(e).visibility === "visible", r: e.getBoundingClientRect().toJSON() })));
    const boxes = all.filter((b) => b.visible);
    const hit = (a: DOMRect, b: DOMRect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    for (const a of boxes) for (const b of boxes) if (a.id < b.id) expect(hit(a.r, b.r), `${a.id} overlaps ${b.id}`).toBe(false);
    // a hidden banner sits where a shown one is (its box is measured even while hidden)
    const tokens = await page.evaluate(() => Object.fromEntries((window as any).__agentTown.world().districts.map((d: any) => [`town-${d.key}`, d.tokens])));
    for (const h of all.filter((b) => !b.visible && b.id.startsWith("town-"))) {
      const cover = boxes.filter((b) => hit(h.r, b.r));
      expect(cover.length, `${h.id} is hidden but nothing covers it`).toBeGreaterThan(0);
      for (const c of cover.filter((c) => c.id.startsWith("town-"))) expect(tokens[c.id], `${c.id} should outrank ${h.id}`).toBeGreaterThanOrEqual(tokens[h.id]);
    }
    expect(boxes.filter((b) => b.id.startsWith("town-")).length).toBeGreaterThanOrEqual(10);
    expect(boxes.filter((b) => b.id.startsWith("capital-"))).toHaveLength(2);
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

test("without the local server, says how to start it instead of drawing an empty world", async ({ page }) => {
  await page.route("**/api/**", (r) => r.abort());
  await page.goto("/");
  await expect(page.getByTestId("loading")).toContainText("本地服务未启动：运行 pnpm start", { timeout: 10_000 });
  expect(await page.evaluate(() => !!(window as any).__agentTown)).toBe(false);
});

test("real data: shows reading progress, then the world from /api/world, badged as real", async ({ page }) => {
  let polls = 0;
  await page.route("**/api/status", (r) => r.fulfill({ json: ++polls < 3 ? { phase: "loading", done: polls * 10, total: 30 } : { phase: "ready", done: 30, total: 30 } }));
  // a tiny real-shaped payload: the demo events, served as if they were real
  await page.route("**/api/world", async (r) => r.fulfill({ json: { events, buildingRows: [], liveTaskIds: [], generatedAt: Date.now(), source: "real" } }));
  await page.goto("/?paused=1");
  await expect(page.getByTestId("loading")).toContainText("正在读取本机日志");
  await page.waitForFunction(() => !!(window as any).__agentTown, null, { timeout: 15_000 });
  await expect(page.getByTestId("source-badge")).toHaveText("真实数据 · 仅本机");
  // real data opens at "now": the end of the record
  const s = await page.evaluate(() => { const st = (window as any).__agentTown.state(); return { t: st.t, duration: st.duration }; });
  expect(s.t).toBe(s.duration);
});

test.describe("click to zoom", () => {
  /** the screen point of the tallest drawn house in a demo history town */
  const houseOnScreen = (page: Page) =>
    page.evaluate(() => {
      const w = (window as any).__agentTown.world();
      const all = w.districts.flatMap((d: any) => d.houses.map((h: any) => ({ d: d.key, h })));
      const { d, h } = all.sort((a: any, b: any) => b.h.floors - a.h.floors)[0];
      const y = (0.6 + h.floors * 0.42) / 2;
      return { district: d, taskId: h.taskId, at: h.at, p: (window as any).__agentTown.toScreen(h.at.x, y, h.at.z) };
    });
  const view = (page: Page) => page.evaluate(() => (window as any).__agentTown.state());
  /** waits until the camera has stopped moving, so a projected point stays where it was computed */
  const settled = (page: Page) => expect.poll(() => page.evaluate(() => (window as any).__agentTownFlying()), { timeout: 15_000 }).toBe(false);

  test("clicking a house pushes in to it and records it in the URL; Escape goes back", async ({ page }) => {
    await open(page, [], "world");
    await settled(page);
    const h = await houseOnScreen(page);
    await page.mouse.click(h.p.x, h.p.y);
    await expect.poll(async () => (await view(page)).zoom, { timeout: 5000 }).toBeGreaterThanOrEqual(38);
    expect((await view(page)).selected).toEqual({ kind: "task", district: h.district, taskId: h.taskId });
    // the flight ends centred on the house
    await expect.poll(async () => { const t = (await view(page)).target; return Math.hypot(t.x - h.at.x, t.z - h.at.z); }, { timeout: 5000 }).toBeLessThan(0.5);
    expect(await page.evaluate(() => location.hash)).toMatch(/^#task=/);
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await view(page)).selected).toBeNull();
    expect(await page.evaluate(() => location.hash)).toBe("");
  });

  test("a drag that starts on a house does not select it", async ({ page }) => {
    await open(page, [], "world");
    await settled(page);
    const h = await houseOnScreen(page);
    await page.mouse.move(h.p.x, h.p.y);
    await page.mouse.down();
    await page.mouse.move(h.p.x + 80, h.p.y + 40, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    expect((await view(page)).selected).toBeNull();
  });

  test("clicking a figure follows it while it walks", async ({ page }) => {
    await open(page, []);
    await at(page, 2000);
    await settled(page);
    const p = await page.evaluate(() => {
      const s = (window as any).__agentTown.snapshot();
      const c = s.actors.find((a: any) => a.id === "main");
      return (window as any).__agentTown.toScreen(s.origin.x + c.pos.x, 0.7, s.origin.z + c.pos.z);
    });
    // the figure is moved to t=2000 on the next rendered frame, and R3F raycasts only on pointer
    // events: under load, a pointer that arrives first hits the ground and stays there
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.mouse.move(p.x, p.y);
    await expect(page.getByTestId("hover-card")).toContainText("指挥官");
    await page.mouse.click(p.x, p.y);
    await expect.poll(async () => (await view(page)).selected?.kind).toBe("agent");
    await page.evaluate(() => (window as any).__agentTown.play());
    await page.waitForTimeout(2500);
    const d = await page.evaluate(() => {
      const st = (window as any).__agentTown.state();
      const s = (window as any).__agentTown.snapshot();
      const c = s.actors.find((a: any) => a.id === "main");
      return Math.hypot(st.target.x - (s.origin.x + c.pos.x), st.target.z - (s.origin.z + c.pos.z));
    });
    expect(d).toBeLessThan(1.5);
  });

  test("a hash in the URL opens on that task", async ({ page }) => {
    await open(page, [], "world");
    const h = await houseOnScreen(page);
    const hash = await page.evaluate((h) => `#task=${encodeURIComponent(h.district)}~${encodeURIComponent(h.taskId)}`, h);
    await page.goto(`/?demo=1&paused=1${hash}`);
    await page.waitForFunction(() => !!(window as any).__agentTown);
    await expect.poll(async () => (await view(page)).selected?.taskId, { timeout: 8000 }).toBe(h.taskId);
    await expect.poll(async () => (await view(page)).zoom, { timeout: 8000 }).toBeGreaterThanOrEqual(38);
  });
});
