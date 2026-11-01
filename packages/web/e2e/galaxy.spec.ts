// The star-system view (spike) on demo data: it loads without errors, draws something, and the
// switch links both views.
import { expect, test } from "@playwright/test";

test.use({ baseURL: "http://127.0.0.1:5180" });

test("the star-system view loads, draws stars and planets, and links back to the town view", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?demo=1&view=galaxy");
  await page.waitForFunction(() => !!(window as any).__galaxyKeys, null, { timeout: 30_000 });
  await page.waitForTimeout(2000);
  // bright pixels: the stars, their shells and the planets must show against the dark sky
  const png = await page.locator("canvas").screenshot();
  const bright = await page.evaluate(async (b64) => {
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
    for (let i = 0; i < d.length; i += 16) if (d[i] + d[i + 1] + d[i + 2] > 240) n++;
    return n / (d.length / 16);
  }, png.toString("base64"));
  expect(bright).toBeGreaterThan(0.002);
  // every planet has its name on the page
  const keys: string[] = await page.evaluate(() => (window as any).__galaxyKeys);
  expect(await page.locator(".g-planet").count()).toBe(keys.length);
  await expect(page.getByTestId("view-switch")).toHaveAttribute("href", /\?demo=1$/);
  expect(errors).toEqual([]);
});

test("the town view offers the star-system view", async ({ page }) => {
  await page.goto("/?demo=1");
  await expect(page.getByTestId("view-switch")).toHaveAttribute("href", /view=galaxy/);
});
