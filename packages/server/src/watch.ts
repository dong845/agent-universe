// Watches the log roots and calls back once per burst of writes to .jsonl files (spec 2026-11-01 A1).
// A root that does not exist is skipped (an owner may use only one of the two tools).
import { existsSync, watch, type FSWatcher } from "node:fs";

export function watchRoots(roots: string[], onChange: () => void, debounceMs = 1500): () => void {
  const watchers: FSWatcher[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, debounceMs);
  };
  for (const root of roots) {
    if (!existsSync(root)) continue;
    try {
      const w = watch(root, { recursive: true }, (_ev, name) => {
        if (name && String(name).endsWith(".jsonl")) fire();
      });
      w.on("error", (e) => console.error(`停止监视 ${root}：${e.message}`));
      watchers.push(w);
    } catch (e) {
      console.error(`无法监视 ${root}：${(e as Error).message}`);
    }
  }
  return () => {
    if (timer) clearTimeout(timer);
    for (const w of watchers) w.close();
  };
}
