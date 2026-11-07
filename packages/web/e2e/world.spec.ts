// The star-system world and its cities on demo data (D18): the picture follows the data. Every check
// reads the rendered page (labels, the hover card, the diary, canvas pixels, the screen points of the
// houses the picker can hit) and compares it with values computed here from the same demo payload.
import { expect, test, type Page } from "@playwright/test";
import { demoPayload } from "../../mock/src/world.ts";

const payload = demoPayload();

test.use({ baseURL: "http://127.0.0.1:5180" });

async function open(page: Page, errors: string[], q = "", hash = "") {
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/?demo=1&paused=1${q}${hash}`);
  await page.waitForFunction(() => !!(window as any).__galaxyKeys && !!(window as any).__agentTown);
  // a focused planet wears the kit city, which the tests' software renderer draws slowly (a real GPU: ~2.5 s)
  await page.waitForFunction(() => (window as any).__agentTownFlying && !(window as any).__agentTownFlying(), null, { timeout: 90_000 });
  await page.waitForTimeout(1500);
}
type Box = { x: number; y: number; width: number; height: number };
const overlap = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
async function visibleBoxes(page: Page, sel: string) {
  return page.$$eval(sel, (els) => els.filter((e) => getComputedStyle(e).visibility === "visible").map((e) => { const r = e.getBoundingClientRect(); return { id: (e as HTMLElement).dataset.label ?? "", x: r.x, y: r.y, width: r.width, height: r.height }; }));
}
/** share of the canvas brighter than the night sky */
async function brightShare(page: Page): Promise<number> {
  const png = await page.locator("canvas").screenshot();
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 16) if (d[i] + d[i + 1] + d[i + 2] > 120) n++;
    return n / (d.length / 16);
  }, png.toString("base64"));
}
const keys = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).__galaxyKeys);

test("the sky loads with a planet and a label for each shown town, a shell meter that matches the data, and no console errors", async ({ page }) => {
  test.slow(); // decoding a full-canvas screenshot in the page takes long under the software renderer on a loaded machine
  const errors: string[] = [];
  await open(page, errors);
  expect(await brightShare(page)).toBeGreaterThan(0.004);
  const shown = await keys(page);
  expect(shown.length).toBeGreaterThan(0);
  const labels = await page.$$eval(".g-planet", (els) => els.map((e) => (e as HTMLElement).dataset.label));
  expect(new Set(labels)).toEqual(new Set(shown.map((k) => `planet|${k}`)));
  // one Dyson panel per finished product of each side, as of the playback time
  const abs: number = await page.evaluate(() => (window as any).__agentTown.state().abs);
  for (const [f, name] of [["claude-code", "Claude Code"], ["codex", "Codex"]] as const) {
    const n = payload.requests.filter((r) => r.faction === f && r.class === "produced" && r.endTs <= abs).length;
    if (payload.towns.some((t) => t.faction === f)) await expect(page.locator(".g-meter")).toContainText(`${name} 戴森壳${Math.min(n, 1280)} / 1280`);
  }
  // the planet labels on screen never overlap
  const vis = await visibleBoxes(page, ".g-planet, .g-star");
  for (const a of vis) for (const b of vis) if (a.id < b.id) expect(overlap(a, b), `${a.id} × ${b.id}`).toBe(false);
  expect(errors).toEqual([]);
});

test("a paused link holds the sky still; playing moves the planets along their orbits", async ({ page }) => {
  await open(page, []);
  const k = (await keys(page))[0];
  const at = () => page.evaluate((key) => { const s = (window as any).__galaxyScreen.get(key); return { x: s.x, y: s.y }; }, k);
  const a = await at();
  await page.waitForTimeout(1500);
  expect(await at()).toEqual(a);
  const sec0: number = await page.evaluate(() => (window as any).__agentTown.orbitSec());
  await page.evaluate(() => (window as any).__agentTown.play());
  // the orbit clock runs and the planet's drawn position follows it (how far it gets in 3 s depends on
  // how many frames the software renderer manages, so the distance is only required to be non-zero)
  await page.waitForFunction((s0) => (window as any).__agentTown.orbitSec() > s0 + 0.3, sec0, { timeout: 30_000 });
  await page.waitForTimeout(500);
  const b = await at();
  expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(0.01);
});

test("hovering a house on a planet shows its request; clicking opens the diary; Escape closes it", async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  await open(page, errors, `&focus=${encodeURIComponent((await (async () => { await page.goto("/?demo=1&paused=1"); await page.waitForFunction(() => !!(window as any).__galaxyKeys); return (await keys(page))[0]; })()))}`);
  const town = await page.evaluate(() => (window as any).__agentTown.state().focus);
  const spots = await page.evaluate((t) => (window as any).__agentTown.spots(t), town);
  const house = spots.find((s: any) => s.kind === "house" && s.x > 100 && s.x < 1340 && s.y > 140 && s.y < 760);
  expect(house).toBeTruthy();
  const req = payload.requests.find((r) => r.requestId === house.requestId)!;
  await page.mouse.move(house.x - 20, house.y - 20);
  await page.mouse.move(house.x, house.y, { steps: 4 });
  const card = page.getByTestId("spot-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText(req.title ?? "（无标题）");
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.getByTestId("diary")).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toMatch(/^#req=/);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("diary")).toBeHidden();
  expect(errors).toEqual([]);
});

test("a #req= link reopens the request; an old #task= link opens the request holding that turn", async ({ page }) => {
  const r = payload.requests.find((x) => x.class === "produced" && x.taskIds.length)!;
  const key = `${r.faction}|${r.projectId}`;
  const enc = (s: string) => encodeURIComponent(s).replace(/~/g, "%7E");
  await open(page, [], "", `#req=${enc(key)}~${enc(r.requestId)}`);
  await expect(page.getByTestId("diary")).toContainText(r.title ?? "（无标题）");
  await open(page, [], "", `#task=${enc(key)}~${enc(r.taskIds[0])}`);
  await expect(page.getByTestId("diary")).toContainText(r.title ?? "（无标题）");
});

test("clicking a planet enters its city: buildings named, back to space works", async ({ page }) => {
  test.slow(); // a city under the tests' software renderer draws a few frames a second
  const errors: string[] = [];
  await open(page, errors);
  const k = (await keys(page))[0];
  // fly to the planet first: from the overview it is a few pixels across, and a click there is a coin toss
  await page.evaluate((key) => (window as any).__agentTown.focus(key), k);
  // the software renderer the tests use draws the focused planet's kit city at a frame or two a second
  // (a real GPU: ~2.5 s, 60 fps at DPR 2)
  await page.waitForFunction(() => !(window as any).__agentTownFlying(), null, { timeout: 90_000 });
  await page.waitForTimeout(800);
  const s = await page.evaluate((key) => (window as any).__galaxyScreen.get(key), k);
  expect(s.px).toBeGreaterThan(30);
  await page.mouse.click(s.x, s.y + s.px * 0.5);
  await expect(page.getByTestId("leave-city")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  // the city's public buildings carry their plain names
  const town = payload.towns.find((t) => t.key === k)!;
  const works = Object.entries(town.workCounts).filter(([w, n]) => n >= 5 && w !== "spawn" && w !== "compaction").length;
  if (works) expect((await visibleBoxes(page, ".g-tag")).length).toBeGreaterThan(0);
  expect(await brightShare(page)).toBeGreaterThan(0.01);
  await page.getByTestId("leave-city").click();
  // a cold dev server builds space's modules on the first way back: under the software renderer that can pass 5 s
  await expect(page.getByTestId("leave-city")).toBeHidden({ timeout: 20_000 });
  await expect(page.locator(".g-meter")).toBeVisible({ timeout: 20_000 });
  expect(errors).toEqual([]);
});

test("a request replayed in its city: a robot appears with what it is doing over its head", async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  await open(page, errors);
  const k = (await keys(page))[0];
  const rid = await page.evaluate((key) => (window as any).__agentTown.requestsOf(key)[0], k);
  await page.evaluate(([key, r]) => (window as any).__agentTown.select({ kind: "request", district: key, requestId: r }), [k, rid]);
  // clicked from inside the page: entering the city loads the kit and compiles its shaders, which can keep
  // the software renderer the tests use busy past Playwright's wait-after-click
  await page.getByTestId("city-replay").waitFor({ timeout: 20_000 });
  await page.getByTestId("city-replay").evaluate((b) => (b as HTMLButtonElement).click());
  await expect(page.getByTestId("replay-bar")).toBeVisible();
  await expect(page.getByTestId("leave-city")).toBeVisible();
  await page.keyboard.press("Escape"); // the diary closes; the city and the replay stay
  await expect(page.locator("[data-testid=robot-bubble]").filter({ hasText: "主代理" }).first()).toBeVisible({ timeout: 40_000 });
  await page.getByRole("button", { name: "结束重放" }).click();
  await expect(page.getByTestId("replay-bar")).toBeHidden();
  expect(errors).toEqual([]);
});
