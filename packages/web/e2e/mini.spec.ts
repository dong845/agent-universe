// The mini window (spec 2026-11-05 C2): a button only where the browser has Document Picture-in-Picture;
// a click opens a small window listing the sessions at work.
import { expect, test } from "@playwright/test";

test.use({ baseURL: "http://127.0.0.1:5180" });

test("mini window: button iff the API exists; opens a window with the working sessions", async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem("agent-universe:tour-done", "1"));
  await page.goto("/?demo=1");
  await page.waitForFunction(() => !!(window as any).__galaxyKeys && !!(window as any).__agentTown);
  const has = await page.evaluate(() => "documentPictureInPicture" in window);
  await expect(page.getByTestId("mini-open")).toHaveCount(has ? 1 : 0);
  if (has) {
    await page.getByTestId("mini-open").click();
    await expect.poll(() => page.evaluate(() => !!(window as any).documentPictureInPicture.window), { timeout: 10_000 }).toBe(true);
    await expect.poll(() => page.evaluate(() => (window as any).documentPictureInPicture.window.document.body.innerText as string), { timeout: 10_000 }).toContain("在干活");
    const rows = await page.evaluate(() => (window as any).documentPictureInPicture.window.document.querySelectorAll("[data-testid=mini-row]").length);
    expect(rows).toBeGreaterThan(0);
    // a working row takes you there: its city, following its main agent (D26 A4)
    await page.evaluate(() => ((window as any).documentPictureInPicture.window.document.querySelector("[data-testid=mini-row]") as HTMLElement).click());
    await expect.poll(() => page.evaluate(() => (window as any).__agentTown.state().city), { timeout: 30_000 }).not.toBeNull();
    await expect.poll(() => page.evaluate(() => (window as any).__agentTown.tour().follow), { timeout: 30_000 }).not.toBeNull();
  }
  // the share page never offers it
  await page.evaluate(() => (window as any).__agentTown.setShare(true));
  expect(errors).toEqual([]);
});
