// World screenshots: node e2e/world-shots.mjs <outdir>
import { chromium } from "@playwright/test";
const out = process.argv[2];
const browser = await chromium.launch({ channel: "chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
await page.goto("http://127.0.0.1:5180/?paused=1");
await page.waitForFunction(() => !!window.__agentTown, null, { timeout: 30000 });
await page.waitForTimeout(2500);
const shot = async (name, fn, wait = 2600) => { await page.evaluate(fn); await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png` }); };
await shot("1-world", () => { window.__agentTown.setTime(12000); });
await shot("2-claude-town", () => { window.__agentTown.focus("primary"); window.__agentTown.setTime(38600); }, 4000);
await shot("3-codex-town", () => { window.__agentTown.focus("codex|/demo/web-shop"); window.__agentTown.setTime(20000); }, 4000);
console.log(JSON.stringify({ errors: errors.slice(0, 8), snap: await page.evaluate(() => { const s = window.__agentTown.snapshot(); return { detail: s.detail, focus: s.focus }; }) }, null, 1));
await browser.close();
