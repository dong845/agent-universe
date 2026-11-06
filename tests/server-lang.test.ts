// The server's language (spec 2026-11-05 D): notifications follow the page's choice, the terminal LANG.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Attention } from "../packages/schema/src/attention.ts";
import { createNotifier } from "../packages/server/src/notify.ts";
import { DEFAULT_SETTINGS, readSettings, writeSettings } from "../packages/server/src/settings.ts";
import { langOf, say } from "../packages/server/src/text.ts";

const a: Attention = { session: "s", faction: "codex", sessionId: "s", projectId: "/p", requestId: null, state: "waiting", since: 1, exact: true };

describe("server language", () => {
  it("LANG decides the terminal's language", () => {
    expect(langOf({ LANG: "zh_CN.UTF-8" })).toBe("zh");
    expect(langOf({ LANG: "en_US.UTF-8" })).toBe("en");
    expect(langOf({ LC_ALL: "zh_TW.UTF-8", LANG: "en_US.UTF-8" })).toBe("zh");
    expect(langOf({})).toBe("en");
  });
  it("say fills placeholders in either language", () => {
    expect(say("en", "port.inUse", { port: 5182 })).toBe("Port 5182 is in use: an Agent Universe may already be running");
    expect(say("zh", "port.inUse", { port: 5182 })).toContain("端口 5182");
  });
  it("notifications use the language the page chose", () => {
    const sent: string[] = [];
    const notify = createNotifier((_, body) => sent.push(body), () => ({ ...DEFAULT_SETTINGS, lang: "en" }), () => "web-shop");
    notify([a]);
    expect(sent).toEqual(["web-shop · waiting for your approval"]);
    const zh: string[] = [];
    createNotifier((_, body) => zh.push(body), () => ({ ...DEFAULT_SETTINGS, lang: "zh" }), () => "web-shop")([a]);
    expect(zh).toEqual(["web-shop · 在等你授权"]);
  });
  it("a question with options says it waits for a choice", () => {
    const sent: string[] = [];
    createNotifier((_, body) => sent.push(body), () => ({ ...DEFAULT_SETTINGS, lang: "en" }), () => "slides")([{ ...a, ask: [{ question: "q", multiSelect: false, options: [] }] }]);
    expect(sent).toEqual(["slides · waiting for your choice"]);
  });
  it("settings keep a valid lang and drop a bad one", () => {
    const f = join(mkdtempSync(join(tmpdir(), "at-lang-")), "settings.json");
    writeSettings(f, { ...DEFAULT_SETTINGS, lang: "en" });
    expect(readSettings(f).lang).toBe("en");
    writeSettings(f, { ...DEFAULT_SETTINGS, lang: "fr" as never });
    expect(readSettings(f).lang).toBeUndefined();
  });
});

describe("npm start's language", () => {
  it("follows LANG", async () => {
    const { langOf: startLang, msg } = await import("../scripts/start.mjs");
    expect(startLang({ LANG: "zh_CN.UTF-8" })).toBe("zh");
    expect(startLang({})).toBe("en");
    expect(msg("running", { url: "http://x/" }, "en")).toBe("Agent Universe is already running: http://x/");
    expect(msg("running", { url: "http://x/" }, "zh")).toBe("Agent Universe 已经在运行：http://x/");
  });
});
