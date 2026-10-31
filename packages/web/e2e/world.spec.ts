// The v3 world on demo data: the picture follows the data. Every check reads the rendered page (DOM
// labels, the hover card, the diary, the canvas pixels, the sprites the picker can hit) and compares
// it with values computed here from the same demo payload.
import { expect, test, type Page } from "@playwright/test";
import { demoPayload } from "../../mock/src/world.ts";

const payload = demoPayload();
const TOWN = "claude-code|/demo/web-shop";

test.use({ baseURL: "http://127.0.0.1:5180" });

async function open(page: Page, errors: string[], q = "", hash = "") {
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/?demo=1&paused=1${q}${hash}`);
  await page.waitForFunction(() => !!(window as any).__agentTown && !!(window as any).__agentTownProject);
  await page.waitForFunction(() => (window as any).__agentTownFlying && !(window as any).__agentTownFlying(), null, { timeout: 15_000 });
  await page.waitForTimeout(1200); // textures decode, labels settle
}
const focusTown = (t: string) => `&focus=${encodeURIComponent(t)}`;
type Box = { x: number; y: number; width: number; height: number };
const overlap = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
async function visibleBoxes(page: Page, sel: string) {
  return page.$$eval(sel, (els) => els.filter((e) => getComputedStyle(e).visibility === "visible").map((e) => { const r = e.getBoundingClientRect(); return { id: (e as HTMLElement).dataset.label ?? "", x: r.x, y: r.y, width: r.width, height: r.height }; }));
}

test("the world loads, draws islands and buildings, and has no console errors", async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  const png = await page.locator("canvas").screenshot();
  // count pixels that are not the sea: islands and sprites must cover a real share of the view
  const share = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let land = 0;
    for (let i = 0; i < d.length; i += 16) if (Math.abs(d[i] - 126) + Math.abs(d[i + 1] - 196) + Math.abs(d[i + 2] - 196) > 60) land++;
    return land / (d.length / 16);
  }, png.toString("base64"));
  expect(share).toBeGreaterThan(0.05);
  expect(errors).toEqual([]);
});

/** share of the canvas that is not open sea */
async function landShare(page: Page): Promise<number> {
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
    let land = 0;
    for (let i = 0; i < d.length; i += 16) if (Math.abs(d[i] - 126) + Math.abs(d[i + 1] - 196) + Math.abs(d[i + 2] - 196) > 60) land++;
    return land / (d.length / 16);
  }, png.toString("base64"));
}

test("the islands stay drawn while time plays", async ({ page }) => {
  await open(page, [], focusTown(TOWN));
  const before = await landShare(page);
  await page.evaluate(() => { (window as any).__agentTown.setSpeed(8); (window as any).__agentTown.play(); });
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => (window as any).__agentTown.state().t)).toBeGreaterThan(1000);
  expect(await landShare(page)).toBeGreaterThan(before * 0.8);
});

test("every town has a banner; the visible ones never overlap", async ({ page }) => {
  await open(page, []);
  const ids = await page.$$eval(".banner", (els) => els.map((e) => (e as HTMLElement).dataset.label));
  expect(new Set(ids)).toEqual(new Set(payload.towns.map((t) => `town|${t.key}`)));
  const shown = await visibleBoxes(page, ".banner");
  expect(shown.length).toBeGreaterThan(payload.towns.length / 2);
  for (const a of shown) for (const b of shown) if (a.id < b.id) expect(overlap(a, b), `${a.id} × ${b.id}`).toBe(false);
});

test("from afar no building names or street signs; up close they show and never overlap", async ({ page }) => {
  await open(page, []);
  expect(await visibleBoxes(page, ".street, .label")).toEqual([]);
  await open(page, [], focusTown(TOWN));
  const streets = await visibleBoxes(page, ".street");
  const names = await visibleBoxes(page, ".label");
  expect(streets.length).toBeGreaterThan(0);
  expect(names.length).toBeGreaterThan(0);
  for (const s of streets) for (const n of names) expect(overlap(s, n), `${s.id} × ${n.id}`).toBe(false);
});

test("hovering a house shows its request; clicking opens the diary; Escape closes it", async ({ page }) => {
  await open(page, [], focusTown(TOWN));
  const spots = await page.evaluate((t) => (window as any).__agentTown.spots(t), TOWN);
  const house = spots.find((s: any) => s.kind === "house" && s.x > 100 && s.x < 1100 && s.y > 120 && s.y < 640);
  expect(house).toBeTruthy();
  const req = payload.requests.find((r) => r.requestId === house.requestId)!;
  await page.mouse.move(house.x - 30, house.y - 30);
  await page.mouse.move(house.x, house.y, { steps: 5 });
  const card = page.getByTestId("spot-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText(req.title ?? "（无标题）");
  await expect(card).toContainText("token");
  await page.mouse.down();
  await page.mouse.up();
  const diary = page.getByTestId("diary");
  await expect(diary).toBeVisible();
  await expect(diary.locator("[data-step]").first()).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toMatch(/^#req=/);
  await page.keyboard.press("Escape");
  await expect(diary).toBeHidden();
  expect(await page.evaluate(() => location.hash)).toBe("");
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

test("clicking a public building opens its town's summary", async ({ page }) => {
  await open(page, [], focusTown(TOWN));
  const label = page.locator(`.label[data-label^="pub|${TOWN}"]`).first();
  const box = (await label.boundingBox())!;
  // the label sits just above its building
  await page.mouse.click(box.x + box.width / 2, box.y + box.height + 30);
  const diary = page.getByTestId("diary");
  await expect(diary).toBeVisible();
  await expect(diary).toContainText("这里做过的工作");
});
