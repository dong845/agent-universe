// An untitled request's facts (RequestRow.gist), worded in the page's language (spec 2026-11-05 D).
import type { GistFacts } from "../../../schema/src/payload.ts";
import { tl, type Lang } from "./index.ts";

/** English singular for one file / one call; a plain string (from an older server) passes through */
export function formatGist(g: GistFacts | string, lang: Lang): string {
  if (typeof g === "string") return g;
  const one = (s: string, n: number) => (lang === "en" && n === 1 ? s.replace("files", "file").replace("calls", "call") : s);
  switch (g.kind) {
    case "edit":
      return one(tl(lang, "gist.edit", { n: g.n, files: g.files.join(tl(lang, "gist.sep")) + (g.n > g.files.length ? tl(lang, "gist.more") : "") }), g.n);
    case "run":
      return tl(lang, "gist.run", { command: g.command });
    case "web":
      return tl(lang, "gist.web", { query: g.query });
    case "read":
      return one(tl(lang, "gist.read", { n: g.n }), g.n);
    case "calls":
      return one(tl(lang, "gist.calls", { n: g.n }), g.n);
  }
}
