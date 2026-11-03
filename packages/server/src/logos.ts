// The official marks (spec 2026-11-03 C2): not in the repository. A settings switch downloads Claude's
// and OpenAI's symbols from Wikimedia Commons into the owner's own folder (~/.agent-town/logos/); the
// page then draws them on this machine only. Exports always use the neutral marks.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Wikimedia Commons, by file name (Special:FilePath redirects to the current file) */
export const LOGO_SOURCES = {
  claude: "https://commons.wikimedia.org/wiki/Special:FilePath/Claude_AI_symbol.svg",
  openai: "https://commons.wikimedia.org/wiki/Special:FilePath/OpenAI_logo_2025_(symbol).svg",
} as const;
type LogoName = keyof typeof LOGO_SOURCES;
const NAMES = Object.keys(LOGO_SOURCES) as LogoName[];
const MAX_BYTES = 200_000;

/** a small SVG with a viewBox and at least one path, and nothing that runs */
function checkSvg(name: string, text: string): void {
  if (text.length > MAX_BYTES) throw new Error(`${name}: larger than ${MAX_BYTES} bytes`);
  if (!/<svg[\s>]/i.test(text) || !/viewBox=/i.test(text) || !/<path[\s>]/i.test(text)) throw new Error(`${name}: not an SVG with a path`);
  if (/<script|\son\w+=|javascript:|<foreignObject/i.test(text)) throw new Error(`${name}: contains script`);
}

export function readLogos(dir: string): Partial<Record<LogoName, string>> {
  const out: Partial<Record<LogoName, string>> = {};
  for (const n of NAMES) {
    const p = join(dir, `${n}.svg`);
    if (!existsSync(p)) continue;
    try {
      const text = readFileSync(p, "utf8");
      checkSvg(n, text);
      out[n] = text;
    } catch {
      // a damaged file is ignored: the neutral mark is drawn
    }
  }
  return out;
}

/** downloads both, checks both, and only then writes both */
export async function downloadLogos(dir: string, fetcher: typeof fetch = fetch): Promise<{ saved: LogoName[] }> {
  const got: [LogoName, string][] = [];
  for (const n of NAMES) {
    const r = await fetcher(LOGO_SOURCES[n], { headers: { "user-agent": "AgentUniverse/1.0 (local tool; downloads two logo files once)" }, redirect: "follow" });
    if (!r.ok) throw new Error(`${n}: download failed (${r.status})`);
    const text = await r.text();
    checkSvg(n, text);
    got.push([n, text]);
  }
  mkdirSync(dir, { recursive: true });
  for (const [n, text] of got) writeFileSync(join(dir, `${n}.svg`), text);
  return { saved: got.map(([n]) => n) };
}

export function removeLogos(dir: string): void {
  for (const n of NAMES) rmSync(join(dir, `${n}.svg`), { force: true });
}
