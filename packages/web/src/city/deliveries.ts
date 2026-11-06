// Cars are deliveries (spec 2026-11-05 D26 A2): when a request ends with a product, a car drives from the
// task hall to that request's house in DRIVE_MS, parks for PARK_MS while fading, and is gone. Pure, on the
// scene clock (live or a replay).
export const DRIVE_MS = 6000;
export const PARK_MS = 3000;

export interface Delivery {
  requestId: string;
  /** 0 at the hall, 1 at the house */
  k: number;
  /** 1 while driving, fading to 0 while parked */
  fade: number;
}

export function deliveriesAt(requests: readonly { requestId: string; endTs: number; class: string }[], now: number): Delivery[] {
  const out: (Delivery & { at: number })[] = [];
  for (const r of requests) {
    if (r.class !== "produced") continue;
    const since = now - r.endTs;
    if (since < 0 || since > DRIVE_MS + PARK_MS) continue;
    const k = Math.min(1, since / DRIVE_MS);
    const fade = since <= DRIVE_MS ? 1 : 1 - (since - DRIVE_MS) / PARK_MS;
    out.push({ requestId: r.requestId, k, fade, at: r.endTs });
  }
  return out.sort((a, b) => a.at - b.at).map(({ at: _, ...d }) => d);
}
