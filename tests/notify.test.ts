import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Attention } from "../packages/schema/src/attention.ts";
import { appleScriptString, createNotifier, notificationText } from "../packages/server/src/notify.ts";
import { DEFAULT_SETTINGS, readSettings, writeSettings, type Settings } from "../packages/server/src/settings.ts";

const a = (state: Attention["state"], session = "claude-code|s1"): Attention => ({ session, faction: "claude-code", sessionId: "s1", projectId: "/synthetic/p", requestId: null, state, since: 1, exact: false });

function harness(s: Partial<Settings> = {}) {
  const sent: string[] = [];
  const settings = { ...DEFAULT_SETTINGS, ...s };
  const n = createNotifier((title, body) => sent.push(`${title}|${body}`), () => settings, () => "示例小镇");
  return { sent, n, settings };
}

describe("notifier", () => {
  it("one notification per state change, not per repeat", () => {
    const h = harness();
    h.n([a("maybe-waiting")]);
    h.n([a("maybe-waiting")]);
    expect(h.sent).toEqual(["Agent Town|示例小镇 · 可能在等你授权"]);
    h.n([a("waiting")]);
    expect(h.sent).toHaveLength(2);
    h.n([]);
    h.n([a("waiting")]);
    expect(h.sent).toHaveLength(3); // gone and back is news again
  });
  it("turn-done only when switched on", () => {
    const h = harness();
    h.n([a("turn-done")]);
    expect(h.sent).toEqual([]);
    const h2 = harness({ notifyTurnDone: true });
    h2.n([a("turn-done")]);
    expect(h2.sent).toEqual(["Agent Town|示例小镇 · 本轮完成，等你回复"]);
  });
  it("nothing when notifications are off", () => {
    const h = harness({ notify: false });
    h.n([a("error")]);
    expect(h.sent).toEqual([]);
  });
  it("texts for every state", () => {
    expect(["maybe-waiting", "waiting", "turn-done", "error"].map((s) => notificationText(s as Attention["state"]))).toEqual(["可能在等你授权", "在等你授权", "本轮完成，等你回复", "出错停止"]);
  });
  it("escapes AppleScript strings", () => {
    expect(appleScriptString('a "b" \\ c')).toBe('"a \\"b\\" \\\\ c"');
  });
});

describe("settings file", () => {
  it("defaults when missing or damaged, round-trips when written", () => {
    const d = mkdtempSync(join(tmpdir(), "at-set-"));
    const f = join(d, "sub", "settings.json");
    expect(readSettings(f)).toEqual(DEFAULT_SETTINGS);
    writeSettings(f, { ...DEFAULT_SETTINGS, notifyTurnDone: true });
    expect(readSettings(f).notifyTurnDone).toBe(true);
    expect(JSON.parse(readFileSync(f, "utf8")).notifyTurnDone).toBe(true);
    writeFileSync(f, "{oops");
    expect(readSettings(f)).toEqual(DEFAULT_SETTINGS);
    writeFileSync(f, JSON.stringify({ notify: "yes", hooks: { claude: true } }));
    expect(readSettings(f)).toEqual({ ...DEFAULT_SETTINGS, hooks: { claude: true, codex: false } });
  });
});
