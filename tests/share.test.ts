// The share mask (spec 2026-11-01 B1): an allowlist, so a field nobody allowed never leaves the machine.
import { describe, expect, it } from "vitest";
import { demoPayload } from "../packages/mock/src/world.ts";
import type { WorldPayload } from "../packages/schema/src/payload.ts";
import { maskedTitle, sharePayload } from "../packages/schema/src/share.ts";
import { codeName, makeShareIds } from "../packages/server/src/shareKeys.ts";

/** values that name a category, not the owner's content: left as they are by the marker walk */
const ENUM_KEYS = new Set(["faction", "kind", "class", "productKind", "theme", "role", "building", "status", "trigger", "triggerBy", "projectBy", "spawnLink", "source", "access", "agentId", "parentAgentId", "agentType"]);

/** every free-text string in the payload replaced by a numbered marker */
function marked(p: WorldPayload): WorldPayload {
  let i = 0;
  const walk = (v: unknown, key = ""): unknown => {
    if (typeof v === "string") return ENUM_KEYS.has(key) ? v : `SECRET-${i++}`;
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    return v;
  };
  return walk(p) as WorldPayload;
}

const ids = makeShareIds("test-secret");

describe("sharePayload", () => {
  it("with names hidden, no free text and no path survives", () => {
    const p = marked({ ...demoPayload(), home: "/Users/someone" });
    // a replay of the first request, with events carrying every private field
    const r = p.requests[0];
    const events = p.events.filter((e) => e.taskId && r.taskIds.includes(e.taskId)).map((e) => ({ ...e, target: "SECRET-t", files: [{ path: "/Users/x/SECRET-f", access: "edit" as const }], title: "SECRET-title", cwd: "/Users/x", agentTask: "SECRET-a", tool: "mcp__SECRET__x", model: "SECRET-m" }));
    const out = JSON.stringify(sharePayload(p, { ids, townNames: false, titles: false, replays: [{ requestId: r.requestId, events }] }));
    expect(out).not.toMatch(/SECRET-/);
    expect(out).not.toMatch(/\/Users\//);
  });
  it("keeps the picture: counts, tokens, classes and one town per town", () => {
    const p = demoPayload();
    const s = sharePayload(p, { ids, townNames: false, titles: false, replays: [] });
    expect(s.source).toBe("share");
    expect(s.towns).toHaveLength(p.towns.length);
    expect(s.requests.map((r) => r.class)).toEqual(p.requests.map((r) => r.class));
    expect(s.requests.map((r) => r.tokens)).toEqual(p.requests.map((r) => r.tokens));
    expect(new Set(s.towns.map((t) => t.name)).size).toBe(p.towns.length); // code names never collide
    // every request still lands in its (renamed) town
    const keys = new Set(s.towns.map((t) => t.key));
    expect(s.requests.every((r) => keys.has(`${r.faction}|${r.projectId}`))).toBe(true);
  });
  it("names and titles shown: still no paths, folders the session ran in, or session ids", () => {
    const p = { ...demoPayload(), home: "/Users/someone" };
    const s = sharePayload(p, { ids, townNames: true, titles: true, replays: [] });
    expect(s.towns.map((t) => t.name)).toEqual(p.towns.map((t) => t.name));
    expect(JSON.stringify(s)).not.toMatch(/\/Users\//);
    expect(s.requests.every((r) => r.cwd === undefined)).toBe(true);
    expect(s.requests.some((r) => p.requests.some((q) => q.sessionId === r.sessionId))).toBe(false);
  });
  it("replay events keep what the city replay needs and pair up", () => {
    const p = demoPayload();
    const r = p.requests.find((x) => x.calls > 3)!;
    const events = p.events.filter((e) => e.taskId && r.taskIds.includes(e.taskId));
    const s = sharePayload(p, { ids, townNames: false, titles: false, replays: [{ requestId: r.requestId, events }] });
    const rep = s.shareReplays![0];
    expect(rep.events).toHaveLength(events.length);
    const starts = rep.events.filter((e) => e.kind === "tool_start").map((e) => e.toolUseId);
    const ends = new Set(rep.events.filter((e) => e.kind === "tool_end").map((e) => e.toolUseId));
    expect(starts.filter((t) => ends.has(t)).length).toBe(events.filter((e) => e.kind === "tool_start" && events.some((x) => x.kind === "tool_end" && x.toolUseId === e.toolUseId)).length);
    expect(rep.events.some((e) => e.agentId === "main")).toBe(events.some((e) => e.agentId === "main"));
    expect(rep.events.every((e) => e.target === undefined && e.files === undefined && e.raw.file === "")).toBe(true);
    expect(rep.requestId).toBe(s.requests.find((x) => x.calls === r.calls && x.startTs === r.startTs)!.requestId);
  });
});

describe("project names on, titles off (the default since 2026-11-01)", () => {
  it("keeps project names, hides titles", () => {
    const p = demoPayload();
    const s = sharePayload(p, { ids, townNames: true, titles: false, replays: [] });
    expect(s.towns.map((t) => t.name)).toEqual(p.towns.map((t) => t.name));
    expect(s.requests.every((r) => /^(完成作品|调查|问答|空请求)/.test(r.title!))).toBe(true);
    expect(JSON.stringify(s)).not.toContain("历史任务");
  });
});

describe("code names", () => {
  it("stable for one secret, different for another, never the key", () => {
    expect(codeName("claude-code|/a/b", "s1")).toBe(codeName("claude-code|/a/b", "s1"));
    expect(codeName("claude-code|/a/b", "s1")).not.toBe(codeName("claude-code|/a/b", "s2"));
    expect(codeName("claude-code|/a/b", "s1")).toMatch(/^[A-Z][a-z]+-\d{2}[a-h]$/);
  });
  it("maskedTitle says what kind of request it was", () => {
    const base = demoPayload().requests[0];
    expect(maskedTitle({ ...base, class: "produced", calls: 12 })).toBe("完成作品 · 12 次调用");
    expect(maskedTitle({ ...base, class: "investigation", calls: 30 })).toBe("调查 · 30 次调用");
    expect(maskedTitle({ ...base, class: "chat", calls: 0 })).toBe("问答");
  });
});

describe("the sentence for untitled requests stays home (spec 2026-11-03 B3)", () => {
  it("is never in a shared world", () => {
    const p = demoPayload();
    const withGist = { ...p, requests: p.requests.map((r) => ({ ...r, title: undefined, gist: { kind: "run" as const, command: "SECRET-command" } })) };
    for (const o of [{ townNames: true, titles: true }, { townNames: false, titles: false }]) {
      expect(JSON.stringify(sharePayload(withGist, { ids, ...o, replays: [] }))).not.toContain("SECRET-command");
    }
  });
});
