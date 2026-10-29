// Which theme a town gets (spec v3 4.6, 6): keyword rules from config/themes.json. Pure.

export interface Theme {
  id: string;
  name: string;
  keywords: string[];
}

export interface ThemesConfig {
  themes: Theme[];
  default: { id: string; name: string };
  fixed: { capital: { id: string; name: string }; outpost: { id: string; name: string } };
}

const words = (text: string) => text.toLowerCase().split(/[^a-z0-9㐀-鿿]+/).filter(Boolean);

/** a word matches a keyword when equal, the keyword plus s/es, or (keywords of 4+ letters) starting with it */
const hits = (word: string, kw: string) => word === kw || word === kw + "s" || word === kw + "es" || (kw.length >= 4 && word.startsWith(kw)) || (/[㐀-鿿]/.test(kw) && word.includes(kw));

/**
 * texts in priority order (the town's name, then its skills' names, then their descriptions): the
 * first text with any match decides, and within it the first theme in the config; else the default
 */
export function pickTheme(texts: string[], cfg: ThemesConfig): string {
  for (const text of texts) {
    const ws = words(text);
    if (!ws.length) continue;
    for (const t of cfg.themes) if (t.keywords.some((k) => ws.some((w) => hits(w, k.toLowerCase())))) return t.id;
  }
  return cfg.default.id;
}

/** every theme id the config knows, fixed ones included */
export function themeIds(cfg: ThemesConfig): Set<string> {
  return new Set([...cfg.themes.map((t) => t.id), cfg.default.id, cfg.fixed.capital.id, cfg.fixed.outpost.id]);
}
