import type { RequestRow } from "../../schema/src/payload.ts";

// What the user clicked (spec 4): a finished task's house, a live site, or one agent. The camera
// pushes in to it and the diary opens; the URL hash keeps it across a reload.
export type Selection =
  | { kind: "request"; district: string; requestId: string }
  | { kind: "town"; district: string }
  | { kind: "task"; district: string; taskId: string }
  | { kind: "site"; district: string }
  | { kind: "agent"; district: string; agentId: string };

/** camera zoom on a selected house */
export const TASK_ZOOM = 40;
/** camera zoom on a selected site or followed agent */
export const SITE_ZOOM = 34;

/** encodeURIComponent leaves "~" alone; it separates the two halves here, so it is escaped too */
const enc = (s: string) => encodeURIComponent(s).replace(/~/g, "%7E");

export function toHash(s: Selection | null): string {
  if (!s) return "";
  if (s.kind === "site") return `#site=${enc(s.district)}`;
  if (s.kind === "town") return `#town=${enc(s.district)}`;
  if (s.kind === "request") return `#req=${enc(s.district)}~${enc(s.requestId)}`;
  return `#${s.kind}=${enc(s.district)}~${enc(s.kind === "task" ? s.taskId : s.agentId)}`;
}

export function fromHash(h: string): Selection | null {
  const v3 = /^#(req|town)=(.+)$/.exec(h);
  if (v3) {
    try {
      if (v3[1] === "town") return { kind: "town", district: decodeURIComponent(v3[2]) };
      const parts = v3[2].split("~");
      if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
      return { kind: "request", district: decodeURIComponent(parts[0]), requestId: decodeURIComponent(parts[1]) };
    } catch {
      return null;
    }
  }
  const m = /^#(task|site|agent)=(.+)$/.exec(h);
  if (!m) return null;
  try {
    if (m[1] === "site") return { kind: "site", district: decodeURIComponent(m[2]) };
    const parts = m[2].split("~"); // both halves are encoded, so a raw "~" only separates them
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const district = decodeURIComponent(parts[0]);
    const id = decodeURIComponent(parts[1]);
    return m[1] === "task" ? { kind: "task", district, taskId: id } : { kind: "agent", district, agentId: id };
  } catch {
    return null; // malformed percent-encoding
  }
}

/** an old #task=… link (one turn) → the request that turn belongs to; null when it is unknown */
export function requestOfTask(sel: Selection, requests: Iterable<RequestRow>): Selection | null {
  if (sel.kind !== "task") return sel;
  for (const r of requests) if (r.taskIds.includes(sel.taskId)) return { kind: "request", district: `${r.faction}|${r.projectId}`, requestId: r.requestId };
  return null;
}
