// Answering from the page (spec 2026-11-05 D26 B2/B4/B5): the server holds a permission hook only while a
// page is watching, answers it with what the page chose, and lets go on every other path.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAsks } from "../packages/server/src/ask.ts";
import { installHooks, uninstallHooks } from "../packages/server/src/hooks.ts";

const Q = { questions: [{ question: "Pick a color", header: "Color", multiSelect: false, options: [{ label: "Red" }, { label: "Blue" }] }] };
const claudeAsk = { session_id: "s1", tool_name: "AskUserQuestion", tool_input: Q, cwd: "/w" };
const claudeBash = { session_id: "s1", tool_name: "Bash", tool_input: { command: "rm -rf build" } };
const codexReq = { session_id: "th1", tool_name: "exec_command", tool_input: { cmd: "git push" } };

function clock() {
  let t = 1000;
  const timers: { at: number; f: () => void }[] = [];
  return {
    now: () => t,
    setTimer: (ms: number, f: () => void) => { const x = { at: t + ms, f }; timers.push(x); return () => { const i = timers.indexOf(x); if (i >= 0) timers.splice(i, 1); }; },
    advance(ms: number) { t += ms; for (const x of [...timers].sort((a, b) => a.at - b.at)) if (x.at <= t) { timers.splice(timers.indexOf(x), 1); x.f(); } },
  };
}
const setup = () => {
  const c = clock();
  const asks = createAsks({ now: c.now, setTimer: c.setTimer, holdMs: 120_000, watchMs: 25_000 });
  const got: string[] = [];
  return { c, asks, got, respond: (b: string) => got.push(b) };
};

describe("holding a hook", () => {
  it("nobody watching: answered at once with nothing (the terminal asks)", () => {
    const { asks, got, respond } = setup();
    asks.hold("claude", claudeAsk, respond);
    expect(got).toEqual([""]);
    expect(asks.pending()).toEqual([]);
  });
  it("a page watching: held, listed with its questions", () => {
    const { asks, got, respond } = setup();
    asks.heartbeat();
    asks.hold("claude", claudeAsk, respond);
    expect(got).toEqual([]);
    expect(asks.pending()).toMatchObject([{ src: "claude", session: "claude-code|s1", kind: "question", tool: "AskUserQuestion", questions: Q.questions }]);
  });
  it("a page gone quiet: not held", () => {
    const { c, asks, got, respond } = setup();
    asks.heartbeat();
    c.advance(26_000);
    asks.hold("claude", claudeAsk, respond);
    expect(got).toEqual([""]);
  });
  it("held at most holdMs, then let go", () => {
    const { c, asks, got, respond } = setup();
    asks.heartbeat();
    asks.hold("claude", claudeAsk, respond);
    c.advance(119_000);
    expect(got).toEqual([]);
    c.advance(2_000);
    expect(got).toEqual([""]);
    expect(asks.pending()).toEqual([]);
  });
});

describe("answers", () => {
  const held = (input: object, src: "claude" | "codex" = "claude") => {
    const s = setup();
    s.asks.heartbeat();
    s.asks.hold(src, input, s.respond);
    return { ...s, id: s.asks.pending()[0].id };
  };
  it("a question: allow with the answers filled into the tool's input", () => {
    const { asks, got, id } = held(claudeAsk);
    expect(asks.answer(id, { answers: { "Pick a color": "Blue" } })).toBe(true);
    expect(JSON.parse(got[0])).toEqual({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow", updatedInput: { ...Q, answers: { "Pick a color": "Blue" } } } } });
    expect(asks.pending()).toEqual([]);
  });
  it("a Claude approval: allow or deny", () => {
    const a = held(claudeBash);
    a.asks.answer(a.id, { behavior: "allow" });
    expect(JSON.parse(a.got[0]).hookSpecificOutput.decision).toEqual({ behavior: "allow" });
    const d = held(claudeBash);
    d.asks.answer(d.id, { behavior: "deny" });
    expect(JSON.parse(d.got[0]).hookSpecificOutput.decision.behavior).toBe("deny");
  });
  it("a Codex approval: allow or deny, nothing else in the decision", () => {
    const a = held(codexReq, "codex");
    expect(a.asks.pending()[0]).toMatchObject({ session: "codex|th1", kind: "approval" });
    a.asks.answer(a.id, { behavior: "deny" });
    expect(JSON.parse(a.got[0])).toEqual({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny" } } });
  });
  it("a question needs answers; an approval needs a behaviour; an unknown id is refused", () => {
    const q = held(claudeAsk);
    expect(q.asks.answer(q.id, { behavior: "allow" })).toBe(false);
    expect(q.asks.answer("nope", { answers: {} })).toBe(false);
    expect(q.got).toEqual([]);
  });
  it("answer in the terminal: released with nothing", () => {
    const { asks, got, id } = held(claudeAsk);
    asks.release(id);
    expect(got).toEqual([""]);
  });
  it("settled by the record: a call the log shows answered lets go", () => {
    const { asks, got } = held(claudeAsk);
    asks.settle((p) => p.session === "claude-code|s1");
    expect(got).toEqual([""]);
  });
  it("the hook's connection closed: forgotten", () => {
    const { asks, id } = held(claudeAsk);
    asks.drop(id);
    expect(asks.pending()).toEqual([]);
  });
});

describe("the ask hook in the agents' files", () => {
  it("installs a PermissionRequest hook beside the alerts and others, and removes only itself", () => {
    const f = join(mkdtempSync(join(tmpdir(), "at-ask-hook-")), "settings.json");
    writeFileSync(f, JSON.stringify({ hooks: { PermissionRequest: [{ matcher: "*", hooks: [{ type: "command", command: "other-tool" }] }] } }));
    installHooks(f, "claude");
    installHooks(f, "claude", {}, "ask");
    const j = JSON.parse(readFileSync(f, "utf8"));
    const pr = j.hooks.PermissionRequest;
    expect(pr).toHaveLength(2);
    expect(pr[1].hooks[0].command).toContain("/api/ask?src=claude");
    expect(pr[1].hooks[0].command).toContain("agent-town-ask");
    expect(pr[1].hooks[0].timeout).toBeGreaterThan(120);
    uninstallHooks(f, {}, "ask");
    const k = JSON.parse(readFileSync(f, "utf8"));
    expect(k.hooks.PermissionRequest).toHaveLength(1);
    expect(k.hooks.Notification).toBeTruthy();
  });
});

describe("over HTTP (spec D26 B5)", async () => {
  const { createServer } = await import("../packages/server/src/http.ts");
  const root = mkdtempSync(join(tmpdir(), "at-ask-http-"));
  const srv = createServer({
    load: async () => ({ events: [], requestOf: new Map(), mtimes: new Map() }) as never,
    staticDir: null,
    themesFile: join(root, "themes.json"),
    watch: () => () => {},
    reloadGapMs: 0,
    settingsFile: join(root, "settings.json"),
    shareSecretFile: join(root, "share-secret"),
    hookFiles: { claude: join(root, "claude.json"), codex: join(root, "codex.json") },
  });
  await new Promise<void>((r) => srv.server.listen(0, "127.0.0.1", r));
  const b = `http://127.0.0.1:${(srv.server.address() as { port: number }).port}`;
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${b}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

  it("no page watching: the hook gets an empty reply at once", async () => {
    const r = await post("/api/ask?src=claude", claudeAsk);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("");
  });
  it("a watching page answers with its token; without it, refused", async () => {
    await post("/api/presence", {});
    const reply = post("/api/ask?src=claude", claudeAsk).then((r) => r.text());
    let list: { id: string }[] = [];
    for (let i = 0; i < 50 && !list.length; i++) {
      list = await (await fetch(`${b}/api/asks`)).json();
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(list).toHaveLength(1);
    expect((await post("/api/ask/answer", { id: list[0].id, answers: { "Pick a color": "Red" } })).status).toBe(403);
    const { token } = await (await fetch(`${b}/api/status`)).json();
    expect((await post("/api/ask/answer", { id: list[0].id, answers: { "Pick a color": "Red" } }, { "x-agent-universe-token": token })).status).toBe(200);
    expect(JSON.parse(await reply).hookSpecificOutput.decision.updatedInput.answers).toEqual({ "Pick a color": "Red" });
    srv.server.close();
  });
});
