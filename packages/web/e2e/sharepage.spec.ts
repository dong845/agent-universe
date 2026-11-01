// The exported share page (spec 2026-11-01 D), opened as a file with every network request blocked:
// it must draw the world, enter a city through an included replay, and show no demo name.
// Needs a current production build (node --run build) in packages/web/dist.
import { expect, test } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { demoPayload } from "../../mock/src/world.ts";
import { sharePayload } from "../../schema/src/share.ts";
import { buildShareHtml } from "../../server/src/exportShare.ts";
import { makeShareIds } from "../../server/src/shareKeys.ts";

test("the share page opens offline: space, a city replay, no real names, no network", async ({ page }) => {
  test.slow();
  const p = demoPayload();
  const r = p.requests.find((x) => x.class === "produced" && x.calls > 3)!;
  const events = p.events.filter((e) => e.taskId && r.taskIds.includes(e.taskId));
  const shared = sharePayload({ ...p, source: "real" }, { ids: makeShareIds("e2e"), realNames: false, replays: [{ requestId: r.requestId, events }] });
  const dist = fileURLToPath(new URL("../dist", import.meta.url));
  const file = join(mkdtempSync(join(tmpdir(), "at-share-")), "share.html");
  writeFileSync(file, buildShareHtml(dist, shared));

  const errors: string[] = [];
  const network: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) => {
    const u = route.request().url();
    if (u.startsWith("file:") || u.startsWith("blob:") || u.startsWith("data:")) return route.continue();
    network.push(u);
    return route.abort();
  });
  await page.goto(`file://${file}`);
  await page.waitForFunction(() => !!(window as any).__galaxyKeys, null, { timeout: 90_000 });
  await page.waitForFunction(() => (window as any).__agentTownFlying && !(window as any).__agentTownFlying(), null, { timeout: 90_000 });
  await page.waitForTimeout(2000);
  await expect(page.getByTestId("source-badge")).toContainText("分享");
  await expect(page.locator(".g-planet").first()).toBeAttached();
  expect(await page.evaluate(() => (window as any).__galaxyEmblems())).toEqual(["neutral"]);
  const names = [...new Set(p.towns.map((t) => t.name))];
  const text = await page.evaluate(() => document.body.innerText);
  for (const n of names) expect(text, n).not.toContain(n);
  await page.getByTestId("share-replays").getByRole("button").first().click();
  await expect(page.getByTestId("replay-bar")).toBeVisible({ timeout: 90_000 });
  await expect(page.locator("[data-testid=robot-bubble]").filter({ hasText: "主代理" }).first()).toBeVisible({ timeout: 90_000 });
  expect(network).toEqual([]);
  expect(errors).toEqual([]);
});
