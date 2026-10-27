// Frame rate on the real GPU (Metal), headless: PORT=5181 node e2e/fps.mjs "focus=primary" "x=world"
// Measure the production build (vite build && vite preview): the dev server adds React dev overhead.
import { chromium } from "@playwright/test";
const browser = await chromium.launch({ channel: "chrome", args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const fps = (page) => page.evaluate(() => new Promise((res) => { const ts = []; const f = (t) => { ts.push(t); if (ts.length < 181) requestAnimationFrame(f); else { const d = ts.slice(1).map((x, i) => x - ts[i]).sort((a, b) => a - b); res(`${(1000 / (d.reduce((a, b) => a + b) / d.length)).toFixed(0)}fps p95=${d[Math.floor(d.length * 0.95)].toFixed(0)}ms`); } }; requestAnimationFrame(f); }));
for (const q of process.argv.slice(2)) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://127.0.0.1:${process.env.PORT || 5180}/?${q}`);
  await page.waitForFunction(() => !!window.__agentTownCamera, null, { timeout: 30000 });
  await page.waitForTimeout(4500);
  console.log(q, "→", await fps(page));
  await page.close();
}
await browser.close();
