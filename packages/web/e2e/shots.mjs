// Screenshots of key moments for a human look: node e2e/shots.mjs <outdir>
import { chromium } from "@playwright/test";
const out = process.argv[2];
const moments = [
  ["01-handover", 1000], ["02-library", 3800], ["03-parallel", 9300], ["04-subagent-test-fails", 16800],
  ["05-report", 18900], ["06-backpack-red", 34800], ["07-rework-cloud", 38600], ["08-awaiting", 46500],
  ["09-denied", 51500], ["10-done", 56500],
];
const browser = await chromium.launch({ channel: "chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
await page.goto("http://127.0.0.1:5180/?demo=1&paused=1");
await page.waitForFunction(() => !!window.__agentTown);
await page.waitForSelector(".label", { state: "visible" }); // the first frame has been drawn
for (const [name, t] of moments) {
  await page.evaluate((t) => window.__agentTown.setTime(t), t);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${name}.png` });
}
// a hover card on the site, at the rework moment
await page.evaluate(() => { window.__agentTown.setTime(38600); window.__agentTown.hover({ kind: "site" }, 760, 380); });
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/11-card-site.png` });
console.log(JSON.stringify(errors.slice(0, 20), null, 1));
await browser.close();
