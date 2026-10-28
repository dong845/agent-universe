// Where the world comes from: the local server (real logs, the default) or the mock (?demo=1).
import { demoPayload } from "../../mock/src/world.ts";
import type { AgentTownEvent } from "../../schema/src/event.ts";
import type { WorldPayload } from "../../schema/src/payload.ts";

export type Progress = { phase: "loading"; done: number; total: number } | { phase: "error"; message: string };

export class ServerDown extends Error {}

let demo: WorldPayload | null = null;

export async function loadWorld(isDemo: boolean, onProgress: (p: Progress) => void): Promise<WorldPayload> {
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
