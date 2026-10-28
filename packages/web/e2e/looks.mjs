// Same moments in every look, for a side-by-side art-direction review: node e2e/looks.mjs <outdir>
import { chromium } from "@playwright/test";
const out = process.argv[2];
const browser = await chromium.launch({ channel: "chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];
for (const look of ["toy", "dusk", "board"]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${look}: ${m.text().slice(0, 160)}`); });
  page.on("pageerror", (e) => errors.push(`${look} pageerror: ${e.message}`));
  await page.goto(`http://127.0.0.1:5180/?demo=1&paused=1&look=${look}`);
  await page.waitForSelector(".label", { state: "visible", timeout: 30000 });
  for (const [name, t] of [["parallel", 9300], ["rework", 38600]]) {
    await page.evaluate((t) => window.__agentTown.setTime(t), t);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}/${look}-${name}.png` });
  }
  await page.close();
}
console.log(JSON.stringify(errors.slice(0, 10), null, 1));
await browser.close();
