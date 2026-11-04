// Where the world comes from: the local server (real logs, the default) or the mock (?demo=1).
import { demoPayload } from "../../mock/src/world.ts";
import type { AgentTownEvent } from "../../schema/src/event.ts";
import type { WorldPayload } from "../../schema/src/payload.ts";
import type { Attention } from "../../schema/src/attention.ts";
import { embeddedWorld } from "./share/embedded.ts";

export type Progress = { phase: "loading"; done: number; total: number } | { phase: "error"; message: string };

export class ServerDown extends Error {}

let demo: WorldPayload | null = null;

export async function loadWorld(isDemo: boolean, onProgress: (p: Progress) => void): Promise<WorldPayload> {
  // a shared page: the world is inside the file
  const shared = embeddedWorld();
  if (shared) return shared;
  if (isDemo) return (demo = demoPayload());
  for (;;) {
    let s: { phase: string; done: number; total: number; error?: string };
    try {
      const r = await fetch("/api/status");
      if (!r.ok) throw new ServerDown(`status ${r.status}`);
      s = await r.json();
    } catch (e) {
      throw e instanceof ServerDown ? e : new ServerDown(String(e));
    }
    if (s.phase === "error") throw new Error(s.error ?? "读取日志失败");
    if (s.phase === "ready") break;
    onProgress({ phase: "loading", done: s.done, total: s.total });
    await new Promise((res) => setTimeout(res, 500));
  }
  const r = await fetch("/api/world");
  if (!r.ok) throw new ServerDown(`world ${r.status}`);
  return (await r.json()) as WorldPayload;
}

const requests = new Map<string, Promise<AgentTownEvent[]>>();

/** every event of a request's turns: from the server, or from the demo's in-memory events */
export function fetchRequest(requestId: string, taskIds: string[]): Promise<AgentTownEvent[]> {
  let p = requests.get(requestId);
  if (!p) {
    const ids = new Set(taskIds);
    const shared = embeddedWorld();
    p = shared
      ? Promise.resolve(shared.shareReplays?.find((r) => r.requestId === requestId)?.events ?? [])
      : demo
      ? Promise.resolve(demo.events.filter((e) => e.taskId && ids.has(e.taskId)))
      : fetch(`/api/request/${encodeURIComponent(requestId)}`).then(async (r) => {
          if (!r.ok) throw new Error(`request ${requestId}: ${r.status}`);
          return ((await r.json()) as { events: AgentTownEvent[] }).events;
        });
    p.catch(() => requests.delete(requestId)); // a failed fetch can be retried
    requests.set(requestId, p);
  }
  return p;
}

const tasks = new Map<string, Promise<AgentTownEvent[]>>();

/** one task's full events: from the server, or from the demo's in-memory events */
export function fetchTask(taskId: string): Promise<AgentTownEvent[]> {
  let p = tasks.get(taskId);
  if (!p) {
    p = demo
      ? Promise.resolve(demo.events.filter((e) => e.taskId === taskId))
      : fetch(`/api/task/${encodeURIComponent(taskId)}`).then(async (r) => {
          if (!r.ok) throw new Error(`task ${taskId}: ${r.status}`);
          return ((await r.json()) as { events: AgentTownEvent[] }).events;
        });
    p.catch(() => tasks.delete(taskId)); // a failed fetch can be retried
    tasks.set(taskId, p);
  }
  return p;
}

/**
 * Live updates from the local server (spec 2026-11-01 A1): a `world` event says a newer world is ready
 * (fetched here, one at a time), an `attention` event carries the "需要你" list. EventSource reconnects
 * by itself after the server restarts. Returns a stop function.
 */
/** the next animation frame (or a short timeout where frames do not run, e.g. a hidden tab) */
const nextFrame = () => new Promise<void>((res) => {
  const t = setTimeout(res, 50);
  requestAnimationFrame(() => { clearTimeout(t); res(); });
});

export function subscribe(on: { world(p: WorldPayload): void; attention(a: Attention[]): void }): () => void {
  const es = new EventSource("/api/stream");
  let busy = false;
  let again = false;
  const pull = async () => {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      const r = await fetch("/api/world");
      if (r.ok) {
        // download, parse and apply in separate frames: together they made one long frame (spec 2026-11-03 A2)
        const text = await r.text();
        await nextFrame();
        const p = JSON.parse(text) as WorldPayload;
        await nextFrame();
        on.world(p);
      }
    } catch {
      // the server is restarting: the stream reconnects and announces the next world
    } finally {
      busy = false;
      if (again) {
        again = false;
        void pull();
      }
    }
  };
  es.addEventListener("world", () => void pull());
  es.addEventListener("attention", (e) => {
    try {
      on.attention(JSON.parse((e as MessageEvent).data) as Attention[]);
    } catch {
      // a damaged message is skipped; the next one replaces the list
    }
  });
  return () => es.close();
}
