import { createHash } from "node:crypto";
import { closeSync, openSync, readSync } from "node:fs";

export function hashId(...parts: string[]): string {
  return createHash("sha1").update(parts.join("\u0000")).digest("hex").slice(0, 16);
}

export interface Line {
  n: number;
  rec: Record<string, any>;
}

export interface ReadStats {
  badLines: number;
  unknownKinds: Map<string, number>;
}

export function newStats(): ReadStats {
  return { badLines: 0, unknownKinds: new Map() };
}

export function countUnknown(stats: ReadStats, kind: string): void {
  stats.unknownKinds.set(kind, (stats.unknownKinds.get(kind) ?? 0) + 1);
}

/**
 * Every parseable JSONL record with its 1-based line number, streamed in chunks: session files reach
 * ~900 MB here, past V8's maximum string length. Broken lines are counted, never thrown.
 */
export function* readJsonl(path: string, stats: ReadStats): Generator<Line> {
  const fd = openSync(path, "r");
  const buf = Buffer.alloc(1 << 22);
  let carry: Buffer[] = [];
  let n = 0;
  const emit = (b: Buffer): Line | undefined => {
    n++;
    const s = b.toString("utf8");
    if (!s.trim()) return undefined;
    try {
      return { n, rec: JSON.parse(s) };
    } catch {
      // the last line of a file being written may be incomplete; the collector re-reads it later
      stats.badLines++;
      return undefined;
    }
  };
  try {
    for (;;) {
      const got = readSync(fd, buf, 0, buf.length, null);
      if (got === 0) break;
      let start = 0;
      for (let i = buf.indexOf(10, 0); i !== -1 && i < got; i = buf.indexOf(10, i + 1)) {
        const piece = buf.subarray(start, i);
        const line = carry.length ? Buffer.concat([...carry, piece]) : piece;
        carry = [];
        const l = emit(line);
        if (l) yield l;
        start = i + 1;
      }
      if (start < got) carry.push(Buffer.from(buf.subarray(start, got)));
    }
    if (carry.length) {
      const l = emit(Buffer.concat(carry));
      if (l) yield l;
    }
  } finally {
    closeSync(fd);
  }
}

export function clip(s: unknown, n: number): string | undefined {
  if (typeof s !== "string" || !s) return undefined;
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
}

export function toMs(ts: unknown): number {
  const v = typeof ts === "number" ? ts : Date.parse(String(ts));
  if (!Number.isFinite(v)) throw new Error(`unparseable timestamp: ${String(ts).slice(0, 40)}`);
  return v;
}
