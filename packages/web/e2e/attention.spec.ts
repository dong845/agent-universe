// The "需要你" list on demo data (spec 2026-11-01 A4): the server's stream is stood in for by the test
// hook that sets the same list.
import { expect, test } from "@playwright/test";

test.use({ baseURL: "http://127.0.0.1:5180" });

test("the 需要你 list: shows a session, flies to its town on click, copies the resume command, hides when empty", async ({ page, context }) => {
  test.slow();
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:5180" });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?demo=1&paused=1");
  await page.waitForFunction(() => !!(window as any).__galaxyKeys && !!(window as any).__agentTown);
  await expect(page.getByTestId("needs-you")).toHaveCount(0);
  const key: string = await page.evaluate(() => (window as any).__galaxyKeys[0]);
  const [faction, ...rest] = key.split("|");
  const rid: string = await page.evaluate((k) => (window as any).__agentTown.requestsOf(k)[0], key);
  await page.evaluate(([f, p, r]) => (window as any).__agentTown.setAttention([{ session: `${f}|demo-s`, faction: f, sessionId: "demo-s", projectId: p, requestId: r, state: "maybe-waiting", since: Date.now() - 25_000, tool: "Bash", exact: false }]), [faction, rest.join("|"), rid]);
  const list = page.getByTestId("needs-you");
  await expect(list).toBeVisible();
  await expect(list).toContainText("可能在等你授权");
  await expect(list).toContainText("需要你 · 1");
  await page.getByTestId("needs-row").locator(".g-need-open").click();
  await expect.poll(() => page.evaluate(() => (window as any).__agentTown.state().focus)).toBe(key);
  await expect.poll(() => page.evaluate(() => (window as any).__agentTown.state().selected?.requestId)).toBe(rid);
  await page.getByRole("button", { name: "复制恢复命令" }).first().click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("demo-s");
  await page.evaluate(() => (window as any).__agentTown.setAttention([]));
  await expect(list).toHaveCount(0);
  expect(errors).toEqual([]);
});
