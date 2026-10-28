// What the user clicked (spec 4): a finished task's house, a live site, or one agent. The camera
// pushes in to it and the diary opens; the URL hash keeps it across a reload.
export type Selection =
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
  return `#${s.kind}=${enc(s.district)}~${enc(s.kind === "task" ? s.taskId : s.agentId)}`;
}

export function fromHash(h: string): Selection | null {
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
