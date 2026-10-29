// A simulated world for the prototype: several projects per faction, two weeks of finished tasks
// (summarised: start, one model call with the task's tokens, end), and two live tasks animated in
// full detail — the Claude demo task and a Codex task on the same project, which the plan's
// cross-faction rule turns into a bridge. All invented; the UI labels it as demo data.
import type { AgentTownEvent } from "../../schema/src/event.ts";
import type { WorldPayload } from "../../schema/src/payload.ts";
import { buildRequests, requestIdsOf } from "../../schema/src/requests.ts";
import type { ThemesConfig } from "../../schema/src/themes.ts";
import { buildTowns } from "../../schema/src/towns.ts";
import { DEFAULT_WORLD_CONFIG } from "../../schema/src/worldConfig.ts";
import themesConfig from "../../../config/themes.json" with { type: "json" };
import { Builder, DEMO, demoScenario, tk } from "./scenario.ts";

export interface MockProject {
  projectId: string;
  faction: AgentTownEvent["faction"];
  tasks: number;
  /** typical task size in tokens (log-normal around it) */
  scale: number;
}

export const MOCK_PROJECTS: MockProject[] = [
  { projectId: "/demo/web-shop", faction: "claude-code", tasks: 46, scale: 900_000 },
  { projectId: "/demo/billing-api", faction: "claude-code", tasks: 28, scale: 600_000 },
  { projectId: "/demo/docs-site", faction: "claude-code", tasks: 9, scale: 200_000 },
  { projectId: "/demo/ml-pipeline", faction: "claude-code", tasks: 34, scale: 2_000_000 },
  { projectId: "/demo/mobile-app", faction: "claude-code", tasks: 17, scale: 700_000 },
  { projectId: "/demo/design-system", faction: "claude-code", tasks: 4, scale: 150_000 },
  { projectId: "/demo/auth-service", faction: "claude-code", tasks: 12, scale: 400_000 },
  { projectId: "/demo/web-shop", faction: "codex", tasks: 14, scale: 500_000 },
  { projectId: "/demo/cli-tools", faction: "codex", tasks: 22, scale: 300_000 },
  { projectId: "/demo/image-lab", faction: "codex", tasks: 8, scale: 1_200_000 },
  { projectId: "/demo/search-index", faction: "codex", tasks: 31, scale: 800_000 },
  { projectId: "/demo/infra-scripts", faction: "codex", tasks: 5, scale: 120_000 },
  { projectId: "/demo/game-engine", faction: "codex", tasks: 19, scale: 1_500_000 },
];

const DAY = 86_400_000;

function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** finished tasks over the 14 days before the live window */
function history(p: MockProject): AgentTownEvent[] {
  const r = rand(seedOf(p.faction + p.projectId));
  const slug = p.projectId.split("/").pop()!;
  const b = new Builder({ faction: p.faction, projectId: p.projectId, sessionId: `${p.faction}:${slug}:history`, prefix: `h:${p.faction}:${slug}`, t0: DEMO.t0 - 14 * DAY });
  const starts = Array.from({ length: p.tasks }, () => r() * 13.5 * DAY).sort((a, b) => a - b);
  starts.forEach((start, i) => {
    const sec = start / 1000;
    const tokens = Math.round(p.scale * Math.exp((r() - 0.5) * 2.2));
    const minutes = 2 + r() * 38;
    b.taskStart(sec, `历史任务 #${i + 1}`);
    // a task's tokens as one call: cache-heavy like real sessions
    b.think("main", sec + 30, tk(Math.round(tokens * 0.02), Math.round(tokens * 0.86), Math.round(tokens * 0.08), Math.round(tokens * 0.04)));
    b.taskEnd(sec + minutes * 60, r() < 0.18 ? "error" : "ok");
  });
  return b.events;
}

/**
 * The Codex live task on /demo/web-shop: reads, a patch, a failing then passing test, a spawned
 * subagent and a guardian reviewing an approval. Starts 5 s into the live window, 12 minutes after
 * the last Claude task on the same project ended — inside the plan's 30-minute bridge window.
 */
function codexLive(): AgentTownEvent[] {
  const b = new Builder({ faction: "codex", projectId: "/demo/web-shop", sessionId: "codex:web-shop:live", prefix: "live:codex", model: "demo-model-c" });
  const C = "src/cart/checkout.ts";
  b.taskStart(5, "结账页接入新的重试客户端");
  b.think("main", 6.5, { ...tk(4200, 18000, 0, 520), reasoning: 300 });
  b.tool("main", 7.0, 0.4, "exec_command", "scout", "rg -n fetchJson src/cart");
  b.tool("main", 8.0, 0.3, "exec_command", "scout", `sed -n 1,80p ${C}`);
  b.think("main", 9.5, { ...tk(2600, 24000, 0, 640), reasoning: 420 });
  const sp = b.spawn(10.5, "codex-sub", "subagent", "scout", "核对购物车的错误码");
  b.think("codex-sub", 12.0, { ...tk(1800, 9000, 0, 260), reasoning: 120 }, "scout");
  b.tool("codex-sub", 12.5, 0.5, "exec_command", "scout", "rg -n ERR_ src/cart");
  b.think("codex-sub", 14.0, { ...tk(900, 11000, 0, 380), reasoning: 90 }, "scout");
  b.ret(15.5, "codex-sub", sp, 10.5);
  b.think("main", 17.0, { ...tk(3100, 30000, 0, 880), reasoning: 610 });
  b.tool("main", 18.0, 0.4, "apply_patch", "smith", C);
  b.tool("main", 19.5, 3.0, "exec_command", "inspector", "pnpm vitest run src/cart", "error");
  b.think("main", 23.5, { ...tk(2400, 36000, 0, 520), reasoning: 380 });
  b.tool("main", 24.5, 0.4, "apply_patch", "smith", C);
  b.tool("main", 26.0, 2.8, "exec_command", "inspector", "pnpm vitest run src/cart");
  // an approval reviewed by the guardian
  b.tool("main", 30.0, 4.0, "exec_command", "engineer", "git push origin checkout-retry");
  b.awaiting("main", 30.1);
  b.think("main", 35.0, { ...tk(1200, 40000, 0, 300), reasoning: 150 });
  b.taskEnd(36.0);
  // the guardian's own rollout: one review call while the push waits
  const g = new Builder({ faction: "codex", projectId: "/demo/web-shop", sessionId: "codex:web-shop:live", prefix: "live:guardian", model: "demo-model-c" });
  g.taskId = b.events[0].taskId;
  g.events.push({
    faction: "codex", projectId: "/demo/web-shop", sessionId: "codex:web-shop:live", taskId: g.taskId, agentId: "guardian-1",
    id: "live:guardian:spawn", ts: DEMO.t0 + 30_200, kind: "agent_spawn", agentType: "guardian", role: "sentry", spawnLink: "none", raw: { file: "live:guardian", line: 1 },
  });
  g.think("guardian-1", 31.5, { ...tk(5200, 0, 0, 180), reasoning: 140 }, "sentry");
  g.events.push({
    faction: "codex", projectId: "/demo/web-shop", sessionId: "codex:web-shop:live", taskId: g.taskId, agentId: "guardian-1",
    id: "live:guardian:return", ts: DEMO.t0 + 33_500, kind: "agent_return", raw: { file: "live:guardian", line: 9 },
  });
  return [...b.events, ...g.events];
}

/** Two weeks of history for every project plus the two live tasks, sorted by time. */
export function worldScenario(): AgentTownEvent[] {
  const all = [...MOCK_PROJECTS.flatMap(history), ...demoScenario(), ...codexLive()];
  // the last Claude web-shop task must end 12 minutes before the Codex live task (bridge window)
  const lastClaude = all.filter((e) => e.faction === "claude-code" && e.projectId === "/demo/web-shop" && e.kind === "task_end" && e.ts < DEMO.t0).sort((a, b) => b.ts - a.ts)[0];
  if (lastClaude) {
    const shift = DEMO.t0 + 5000 - 12 * 60_000 - lastClaude.ts;
    const tid = lastClaude.taskId;
    for (const e of all) if (e.taskId === tid) e.ts += shift;
  }
  return all.sort((a, b) => a.ts - b.ts);
}

/** the demo world as the browser loads it (?demo=1): every event in full, live = tasks with tool calls */
export function demoPayload(): WorldPayload {
  const events = worldScenario();
  const live = [...new Set(events.filter((e) => e.kind === "tool_start" && e.taskId).map((e) => e.taskId!))];
  const requests = buildRequests(events, requestIdsOf(events), DEFAULT_WORLD_CONFIG);
  const towns = buildTowns(requests, events, { themes: themesConfig as ThemesConfig, overrides: {}, guildSkillsOf: () => [], describe: () => undefined });
  return { events, buildingRows: [], liveTaskIds: live, generatedAt: Math.max(...events.map((e) => e.ts)), source: "demo", requests, towns };
}
