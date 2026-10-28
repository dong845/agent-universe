// Small display rules shared by the HUD, the replay bar and the label overlay.

const pad = (n: number) => String(n).padStart(2, "0");

/** the replay clock: mm:ss into the demo, or the local date and time on real data (months of record) */
export function clockLabel(t: number, t0: number, source: "real" | "demo"): string {
  if (source === "demo") {
    const s = Math.floor(t / 1000);
    return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
  }
  const d = new Date(t0 + t);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface LabelBox {
  id: string;
  rect: { x: number; y: number; w: number; h: number };
  priority: number;
}

/** the labels to show: greedily by priority (ties by id), skipping any that overlaps one already kept */
export function declutter(labels: LabelBox[]): Set<string> {
  const order = [...labels].sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const kept: LabelBox["rect"][] = [];
  const out = new Set<string>();
  for (const l of order) {
    const r = l.rect;
    if (kept.some((k) => r.x < k.x + k.w && k.x < r.x + r.w && r.y < k.y + k.h && k.y < r.y + r.h)) continue;
    kept.push(r);
    out.add(l.id);
  }
  return out;
}
