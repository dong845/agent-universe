// A request is what the user asked for: one human-opened turn plus every system-opened turn that
// continues it (subagent hand-backs, compaction summaries, other meta lines) — spec v3 4.1.
// Pure: the browser builds the demo with it too.
import { addTokens, zeroTokens, type AgentTownEvent } from "./event.ts";
import type { ProductKind, RequestRow } from "./payload.ts";
import { skillsOfEvent } from "./skills.ts";
import type { WorldConfig } from "./worldConfig.ts";

/**
 * taskId → requestId. A human turn (or one with no trigger) is its own request; a system turn joins
 * the latest human turn of the same faction and session that started at or before it, else it is
 * its own request.
 */
export function requestIdsOf(events: AgentTownEvent[]): Map<string, string> {
  const starts = events.filter((e) => e.kind === "task_start" && e.taskId).sort((a, b) => a.ts - b.ts);
  const lastHuman = new Map<string, string>();
  const out = new Map<string, string>();
  for (const e of starts) {
    const taskId = e.taskId!;
    if (out.has(taskId)) continue;
    const session = `${e.faction}|${e.sessionId}`;
    if (e.trigger === "system") {
      out.set(taskId, lastHuman.get(session) ?? taskId);
    } else {
      lastHuman.set(session, taskId);
      out.set(taskId, taskId);
    }
  }
  return out;
}

/** replies that only say "go on": they name no work of their own */
const BARE = new Set(["可以", "可以的", "继续", "继续吧", "好", "好的", "行", "嗯", "嗯嗯", "是", "是的", "对", "对的", "同意", "开始", "开始吧", "执行", "没问题", "确认", "好的继续", "ok", "okay", "yes", "y", "go", "goahead", "continue", "proceed", "sure", "yep", "lgtm"]);
export const isBareReply = (title: string): boolean => {
  const t = title.toLowerCase().replace(/[\s\p{P}~]+/gu, "");
  // a bare word, an option picked from a list ("1", "B"), or a short "继续…" (继续优化, 继续尝试)
  return BARE.has(t) || /^[a-z0-9]$/.test(t) || (t.startsWith("继续") && t.length <= 4);
};

const KIND_ORDER: ProductKind[] = ["code", "docs", "slides", "image", "video", "data"];
const IMAGE_TOOL = /image_gen|imagegen/i;

function kindOfPath(path: string, cfg: WorldConfig): ProductKind {
  const p = path.toLowerCase();
  const name = p.split(/[\\/]/).pop() ?? p;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1) : "";
  if (/[\\/]remotion[\\/]/.test(p)) return "video";
  if ((ext === "html" || ext === "pdf") && /slides|deck/.test(p)) return "slides";
  for (const k of KIND_ORDER) if (cfg.productExt[k].includes(ext)) return k;
  // spec 4.3: no extension → code (Makefile, scripts); any other extension → data
  return ext ? "data" : "code";
}

/** the first folder of `path` below `root`, "." for a file directly in it; null when outside it */
function topDirOf(path: string, root: string): string | null {
  const r = root.endsWith("/") || root.endsWith("\\") ? root : root + "/";
  if (!path.startsWith(r) && !path.startsWith(root + "\\")) return null;
  const rest = path.slice(r.length).split(/[\\/]/).filter(Boolean);
  return rest.length > 1 ? rest[0] : ".";
}

const isPath = (p: string) => p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p);

/** one row per request (spec v3 4.1–4.3); every event of a task belongs to its request */
const work = (r: RequestRow, k: string) => {
  r.work ??= {};
  r.work[k] = (r.work[k] ?? 0) + 1;
};
const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const list = (names: string[], total: number, unit: string) =>
  `${total} ${unit}：${names.slice(0, 2).join("、")}${total > 2 ? " 等" : ""}`;

/**
 * What an untitled request did, in one sentence from its own events (spec 2026-11-03 B3) — facts only:
 * the files it edited, else its first command, else what it looked up or read, else how many calls.
 */
function gistOf(a: { edited: Map<string, number>; command?: string; web?: string; reads: number; calls: number }): string | undefined {
  if (a.edited.size) return `改了 ${list([...a.edited.keys()].map(base), a.edited.size, "个文件")}`;
  if (a.command) return `跑命令：${a.command}`;
  if (a.web) return `联网：${a.web}`;
  if (a.reads) return `读了 ${a.reads} 个文件`;
  if (a.calls) return `调用了 ${a.calls} 次工具`;
  return undefined;
}

export function buildRequests(events: AgentTownEvent[], requestOf: Map<string, string>, cfg: WorldConfig): RequestRow[] {
  interface Acc {
    row: RequestRow;
    ended: Set<string>;
    kinds: Map<ProductKind, number>;
    dirs: Map<string, number>;
    image: boolean;
    edits: number;
    /** for the sentence of an untitled request: files edited (in order), the first command, reads, web */
    edited: Map<string, number>;
    command?: string;
    reads: number;
    web?: string;
    calls: number;
  }
  const acc = new Map<string, Acc>();
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  for (const e of sorted) {
    if (!e.taskId) continue;
    const id = requestOf.get(e.taskId) ?? e.taskId;
    let a = acc.get(id);
    if (!a) {
      a = {
        row: { requestId: id, faction: e.faction, projectId: e.projectId, sessionId: e.sessionId, startTs: e.ts, endTs: e.ts, ok: null, class: "empty", productKind: null, tokens: zeroTokens(), calls: 0, fails: 0, spawns: 0, skills: [], topDir: null, turns: 0, taskIds: [] },
        ended: new Set(),
        kinds: new Map(),
        dirs: new Map(),
        image: false,
        edits: 0,
        edited: new Map(),
        reads: 0,
        calls: 0,
      };
      acc.set(id, a);
    }
    const r = a.row;
    r.endTs = Math.max(r.endTs, e.ts);
    if (!r.taskIds.includes(e.taskId)) r.taskIds.push(e.taskId);
    switch (e.kind) {
      case "task_start":
        r.turns++;
        if (e.taskId === id && e.title) r.title = e.title;
        if (!r.cwd && e.cwd) r.cwd = e.cwd;
        break;
      case "task_end":
        a.ended.add(e.taskId);
        if (e.status && e.status !== "ok") r.ok = false;
        break;
      case "model_call":
        if (e.tokens) addTokens(r.tokens, e.tokens);
        break;
      case "tool_end":
        if (e.status && e.status !== "ok") r.fails++;
        break;
      case "agent_spawn":
        r.spawns++;
        work(r, "spawn");
        break;
      case "compaction":
        work(r, "compaction");
        break;
      case "tool_start": {
        r.calls++;
        if (e.role) work(r, e.role);
        a.calls++;
        if (e.role === "engineer" && e.target && a.command === undefined) a.command = e.target;
        if (e.role === "messenger" && e.target && a.web === undefined) a.web = e.target;
        if (e.files?.length && e.files.every((f) => f.access === "read")) a.reads += e.files.length;
        for (const f of e.files ?? []) if (f.access === "edit") a.edited.set(f.path, (a.edited.get(f.path) ?? 0) + 1);
        for (const s of skillsOfEvent(e)) if (!r.skills.includes(s)) r.skills.push(s);
        if (e.tool && IMAGE_TOOL.test(e.tool)) {
          a.image = true;
          a.kinds.set("image", (a.kinds.get("image") ?? 0) + 1);
        }
        for (const f of e.files ?? []) {
          if (f.access !== "edit") continue;
          a.edits++;
          const k = kindOfPath(f.path, cfg);
          a.kinds.set(k, (a.kinds.get(k) ?? 0) + 1);
          if (isPath(r.projectId) && isPath(f.path)) {
            const d = topDirOf(f.path, r.projectId);
            if (d !== null) a.dirs.set(d, (a.dirs.get(d) ?? 0) + 1);
          }
        }
        break;
      }
    }
  }
  const out: RequestRow[] = [];
  for (const a of acc.values()) {
    const r = a.row;
    if (!r.title) {
      const g = gistOf(a);
      if (g) r.gist = g;
    }
    if (r.ok !== false) r.ok = r.taskIds.every((t) => a.ended.has(t)) ? true : null;
    if (a.edits > 0 || a.image) {
      r.class = "produced";
      let best: ProductKind = "code";
      let n = -1;
      for (const k of KIND_ORDER) if ((a.kinds.get(k) ?? 0) > n) [best, n] = [k, a.kinds.get(k) ?? 0];
      r.productKind = best;
      let top: string | null = null;
      let m = 0;
      for (const [d, c] of a.dirs) if (c > m) [top, m] = [d, c];
      r.topDir = top;
    } else r.class = r.calls >= cfg.investigationCalls ? "investigation" : r.calls >= 1 ? "chat" : "empty";
    out.push(r);
  }
  out.sort((x, y) => x.startTs - y.startTs);
  // a bare "可以" / "继续" continues the session's last request that said what it wanted (owner 2026-10-29)
  const lastSaid = new Map<string, string>();
  for (const r of out) {
    const s = `${r.faction}|${r.sessionId}`;
    if (!r.title) continue;
    if (!isBareReply(r.title)) lastSaid.set(s, r.title.replace(/^接续：/, ""));
    else if (lastSaid.has(s)) {
      r.asked = r.title;
      r.title = `接续：${lastSaid.get(s)}`;
    }
  }
  return out;
}
