// Tunable numbers of the v3 world (spec v3 4.2, 4.3, 5). `config/world.json` holds the same values;
// the server merges it over these defaults.
import type { ProductKind } from "./payload.ts";

export interface WorldConfig {
  /** a request with no edits and at least this many tool calls is an investigation */
  investigationCalls: number;
  /** finished work needed for each landmark size */
  landmarkTiers: [number, number, number];
  maxStreets: number;
  /** file extensions (lower case, no dot) voting for each product kind */
  productExt: Record<ProductKind, string[]>;
}

export const DEFAULT_WORLD_CONFIG: WorldConfig = {
  investigationCalls: 20,
  landmarkTiers: [1, 10, 40],
  maxStreets: 6,
  productExt: {
    code: ["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rs", "go", "java", "kt", "swift", "c", "h", "cc", "cpp", "hpp", "cs", "rb", "php", "sh", "zsh", "bash", "css", "scss", "html", "vue", "svelte", "sql", "lua", "r", "scala", "ipynb"],
    docs: ["md", "markdown", "txt", "rst", "tex"],
    slides: ["pptx", "ppt", "key", "odp"],
    image: ["png", "jpg", "jpeg", "svg", "webp", "gif"],
    video: ["mp4", "mov", "webm", "mp3", "wav", "m4a", "srt", "vtt"],
    data: ["json", "jsonl", "yaml", "yml", "toml", "csv", "tsv", "xml", "xlsx"],
  },
};
