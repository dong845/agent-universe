// The share page (spec 2026-11-01 D): one HTML file that opens offline — the built app inlined, the city
// kit and robot models embedded, and the masked world. The official marks' model (emblems.glb) is never
// embedded: a shared world draws our own neutral emblems (B2).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorldPayload } from "../../schema/src/payload.ts";
import { say, type Lang } from "./text.ts";

/** the models a shared world needs, by name (public/models/<name>.glb) */
export const SHARE_MODELS = ["city", "robot"] as const;
export const SHARE_TARGET_BYTES = 15_000_000;
export const SHARE_MAX_BYTES = 40_000_000;

export class ShareTooBig extends Error {
  // plain fields: node runs this file by stripping types, which has no parameter properties
  readonly bytes: number;
  readonly parts: { name: string; bytes: number }[];
  constructor(bytes: number, parts: { name: string; bytes: number }[], lang: Lang = "zh") {
    super(say(lang, "export.tooBig", { mb: (bytes / 1e6).toFixed(1), parts: parts.slice(0, 3).map((p) => `${p.name} ${(p.bytes / 1e6).toFixed(1)} MB`).join(lang === "zh" ? "、" : ", ") }));
    this.bytes = bytes;
    this.parts = parts;
  }
}

/** JSON that can sit inside a <script> block: no "<" survives to start a closing tag */
const embedJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
/** a script body that cannot close its own block early (`<\/script` means the same inside JS strings) */
const embedJs = (s: string) => s.replace(/<\/(script)/gi, "<\\/$1");
const embedCss = (s: string) => s.replace(/<\/(style)/gi, "<\\/$1");

export function buildShareHtml(dist: string, payload: WorldPayload, maxBytes = SHARE_MAX_BYTES, lang: Lang = "zh"): string {
  const index = readFileSync(join(dist, "index.html"), "utf8");
  const scripts = [...index.matchAll(/<script[^>]*\ssrc="\/([^"]+)"[^>]*><\/script>/g)];
  if (scripts.length !== 1) throw new Error(say(lang, "export.oneScript", { n: scripts.length }));
  const styles = [...index.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="\/([^"]+)"[^>]*>/g)];
  const js = readFileSync(join(dist, scripts[0][1]), "utf8");
  // inside a <script> block, "<!--" sends the HTML parser into a state where a later "<script" makes
  // the block's own end tag invisible: the page would never start. Refuse loudly rather than write it.
  if (/<!--/.test(js)) throw new Error(say(lang, "export.comment"));
  const css = styles.map((m) => readFileSync(join(dist, m[1]), "utf8")).join("\n");
  const models = Object.fromEntries(SHARE_MODELS.map((m) => [m, readFileSync(join(dist, "models", `${m}.glb`)).toString("base64")]));

  const parts = [
    { name: say(lang, "export.part.js"), bytes: js.length },
    { name: say(lang, "export.part.css"), bytes: css.length },
    ...SHARE_MODELS.map((m) => ({ name: say(lang, "export.part.model", { name: m }), bytes: models[m].length })),
    { name: say(lang, "export.part.world"), bytes: embedJson(payload).length },
  ].sort((a, b) => b.bytes - a.bytes);
  const total = parts.reduce((a, p) => a + p.bytes, 0);
  if (total > maxBytes) throw new ShareTooBig(total, parts, lang);

  let html = index;
  html = html.replace(scripts[0][0], () => "");
  for (const m of styles) html = html.replace(m[0], () => "");
  // function replacers: a replacement string would read "$&", "$'" … in the minified app as patterns
  html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${say(lang, "export.title")}</title>`);
  html = html.replace("</head>", () => `<style>${embedCss(css)}</style>\n</head>`);
  html = html.replace(
    '<div id="root"></div>',
    () => `<div id="root"></div>\n<script type="application/json" id="agent-town-share">${embedJson(payload)}</script>\n<script type="application/json" id="agent-town-models">${embedJson(models)}</script>\n<script type="module">${embedJs(js)}</script>`,
  );
  return html;
}
