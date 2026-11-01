// The share page (spec 2026-11-01 D): one HTML file holding the app, the models and the masked world.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { demoPayload } from "../packages/mock/src/world.ts";
import { sharePayload } from "../packages/schema/src/share.ts";
import { buildShareHtml, SHARE_MODELS } from "../packages/server/src/exportShare.ts";
import { makeShareIds } from "../packages/server/src/shareKeys.ts";

function fakeDist(chunks = 1) {
  const d = mkdtempSync(join(tmpdir(), "at-dist-"));
  mkdirSync(join(d, "assets"));
  mkdirSync(join(d, "models"));
  const scripts = Array.from({ length: chunks }, (_, i) => `<script type="module" crossorigin src="/assets/index-${i}.js"></script>`).join("\n");
  writeFileSync(join(d, "index.html"), `<!doctype html><html><head><title>t</title>${scripts}<link rel="stylesheet" crossorigin href="/assets/index-a.css"></head><body><div id="root"></div></body></html>`);
  // "$&" and "$'" are replacement patterns to String.replace: the app must come through byte for byte
  for (let i = 0; i < chunks; i++) writeFileSync(join(d, "assets", `index-${i}.js`), `console.log("app ${i}"); const s = "</script>"; const d = "$&$'$\`$$";`);
  writeFileSync(join(d, "assets", "index-a.css"), "body{color:red}");
  for (const m of SHARE_MODELS) writeFileSync(join(d, "models", `${m}.glb`), Buffer.from(`glb-${m}`));
  writeFileSync(join(d, "models", "emblems.glb"), "OFFICIAL-MARKS");
  return d;
}
const payload = () => sharePayload({ ...demoPayload(), requests: demoPayload().requests.map((r, i) => (i === 0 ? { ...r, title: "x</script><script>alert(1)</script>" } : r)) }, { ids: makeShareIds("s"), realNames: true, replays: [] });

describe("buildShareHtml", () => {
  it("inlines the script, the style and the models; no local file references remain", () => {
    const html = buildShareHtml(fakeDist(), payload());
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+href="\/assets/);
    expect(html).toContain('console.log("app 0")');
    expect(html).toContain(`const d = "$&$'$\`$$";`);
    expect(html).toContain("body{color:red}");
    expect(html).toContain('id="agent-town-share"');
    expect(html).toContain(Buffer.from("glb-city").toString("base64"));
  });
  it("never carries the official marks' model", () => {
    expect(buildShareHtml(fakeDist(), payload())).not.toContain(Buffer.from("OFFICIAL-MARKS").toString("base64"));
  });
  it("text that looks like a closing script tag cannot end an embedded block early", () => {
    const html = buildShareHtml(fakeDist(), payload());
    // the only </script> closings are the blocks' own: payload, models, app
    expect(html.match(/<\/script>/g)!.length).toBe(3);
    expect(html).not.toContain("<script>alert(1)");
  });
  it("refuses a build split into several chunks", () => {
    expect(() => buildShareHtml(fakeDist(2), payload())).toThrow(/一个脚本/);
  });
});

describe("a bundle the HTML parser could misread (review I4)", () => {
  it("refuses a script containing <!-- instead of writing a page that never starts", () => {
    const d = fakeDist();
    writeFileSync(join(d, "assets", "index-0.js"), 'const a = "<!--"; const b = "<script>";');
    expect(() => buildShareHtml(d, payload())).toThrow(/<!--/);
  });
});
