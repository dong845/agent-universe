// Fixes from the D25 whole-branch review: each test reproduces a finding.
import * as THREE from "../packages/web/node_modules/three/build/three.module.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentTownEvent } from "../packages/schema/src/event.ts";
import { agentFacts } from "../packages/web/src/city/agentFacts.ts";
import { useReplay } from "../packages/web/src/city/cityReplay.ts";
import { DEFAULT_PLACES } from "../packages/web/src/orchestrator/layout.ts";
import { visibleRaycast } from "../packages/web/src/city/hit.ts";
import { grabFrame } from "../packages/web/src/share/grab.ts";

const base = { faction: "claude-code" as const, projectId: "/p", sessionId: "s", taskId: "t1", raw: { file: "", line: 0 } };
let n = 0;
const ev = (agentId: string, ts: number, kind: AgentTownEvent["kind"], extra: Partial<AgentTownEvent> = {}): AgentTownEvent => ({ ...base, id: `e${n++}`, ts, agentId, kind, ...extra });

afterEach(() => vi.useRealTimers());

describe("follow card facts (review: empty card on replays and the share page)", () => {
  it("says whether the agent was seen at all, so the card can stay closed rather than show wrong facts", () => {
    const events = [ev("main", 1, "task_start"), ev("main", 2, "tool_start", { tool: "Read", toolUseId: "u", role: "scout" })];
    expect(agentFacts(events, "main", 5, { share: false, titles: true }).seen).toBe(true);
    expect(agentFacts([], "main", 5, { share: false, titles: true }).seen).toBe(false);
  });
  it("a replay keeps its own events, on its own clock, for the card", () => {
    const events = [ev("main", 1000, "task_start"), ev("main", 2000, "tool_start", { tool: "Read", toolUseId: "u", role: "scout" }), ev("main", 3000, "task_end")];
    useReplay.getState().start("claude-code|/p", "r1", "x", events, DEFAULT_PLACES);
    const r = useReplay.getState().r!;
    expect(r.events.map((e) => e.id)).toEqual(events.map((e) => e.id));
    expect(r.tl.t0).toBe(r.events[0].ts);
    useReplay.getState().stop();
  });
});

describe("poster frame grab (review: a grab that never comes)", () => {
  it("gives up after a while instead of waiting for ever", async () => {
    vi.useFakeTimers();
    const p = grabFrame(1500);
    vi.advanceTimersByTime(1600);
    await expect(p).resolves.toBeNull();
  });
});

describe("robot hit capsule (review: invisible robots can be clicked)", () => {
  it("only hits while the robot is shown", () => {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshBasicMaterial());
    mesh.raycast = visibleRaycast(() => root, mesh);
    root.add(mesh);
    root.updateMatrixWorld(true);
    const rc = new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1));
    expect(rc.intersectObject(root, true).length).toBeGreaterThan(0);
    root.visible = false;
    expect(rc.intersectObject(root, true).length).toBe(0);
  });
});
