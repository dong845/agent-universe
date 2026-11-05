// English interface (spec 2026-11-05 D): every Chinese string of the page lives in i18n/zh.ts. Comments
// may stay Chinese; code may not.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../packages/web/src/", import.meta.url).pathname;
const files = (d: string): string[] => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? files(p) : /\.(tsx?|css)$/.test(n) ? [p] : [];
});
/** the code without its comments (line, block and JSX ones); string contents are kept */
export function stripComments(src: string): string {
  let out = "", i = 0;
  let q: string | null = null;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (q) {
      out += c;
      if (c === "\\") { out += d ?? ""; i += 2; continue; }
      if (c === q) q = null;
      i++;
    } else if (c === "/" && d === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && d === "*") {
      i = src.indexOf("*/", i + 2);
      i = i < 0 ? src.length : i + 2;
    } else {
      if (c === '"' || c === "'" || c === "`") q = c;
      out += c;
      i++;
    }
  }
  return out;
}
const CJK = /[　-〿㐀-鿿＀-￯]/;

describe("no Chinese outside the dictionary", () => {
  it("strips comments but keeps strings", () => {
    expect(stripComments('const a = "中"; // 注释\n/* 块 */ b')).toBe('const a = "中"; \n b');
    expect(stripComments("x = '//不是注释'")).toBe("x = '//不是注释'");
  });
  it("packages/web/src", () => {
    const bad: string[] = [];
    for (const f of files(ROOT)) {
      const rel = relative(ROOT, f);
      if (rel === "i18n/zh.ts" || rel.endsWith(".css")) continue;
      stripComments(readFileSync(f, "utf8")).split("\n").forEach((line, n) => {
        // the English page offers the switch back to Chinese in Chinese
        if (rel === "i18n/en.ts" && /^\s*"lang\./.test(line)) return;
        if (CJK.test(line)) bad.push(`${rel}:${n + 1}: ${line.trim().slice(0, 90)}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
