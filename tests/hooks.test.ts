// The optional precise hooks (spec 2026-11-01 A3): merged into the owner's own hook file, backed up,
// removable without touching anything else. Temp files only.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HOOK_MARKER, hookCommand, hooksInstalled, installHooks, uninstallHooks } from "../packages/server/src/hooks.ts";

const dir = () => mkdtempSync(join(tmpdir(), "at-hooks-"));
const read = (f: string) => JSON.parse(readFileSync(f, "utf8"));

describe("hook command", () => {
  it("never blocks: 1 s timeout, output discarded, always succeeds, port from the port file", () => {
    const c = hookCommand("claude");
    expect(c).toContain("-m 1");
    expect(c).toContain(">/dev/null 2>&1 || true");
    expect(c).toContain(".agent-town/port");
    expect(c).toContain("src=claude");
    expect(c).toContain(HOOK_MARKER);
  });
});

describe("install / uninstall", () => {
  it("into a missing file: only our entries, no backup", () => {
    const f = join(dir(), "settings.json");
    const r = installHooks(f, "claude");
    expect(r.backup).toBeNull();
    expect(r.added).toEqual(["Notification", "Stop"]);
    const j = read(f);
    expect(j.hooks.Notification[0].matcher).toBe("permission_prompt");
    expect(j.hooks.Stop[0].hooks[0].command).toContain(HOOK_MARKER);
    expect(hooksInstalled(f)).toBe(true);
  });
  it("Codex uses PermissionRequest and Stop", () => {
    const f = join(dir(), "hooks.json");
    expect(installHooks(f, "codex").added).toEqual(["PermissionRequest", "Stop"]);
    expect(read(f).hooks.PermissionRequest[0].hooks[0].command).toContain("src=codex");
  });
  it("merges with the owner's hooks, keeps a byte-equal backup, uninstall restores the content", () => {
    const d = dir();
    const f = join(d, "settings.json");
    const original = '{\n    "model": "x",\n  "hooks": { "Notification": [ { "hooks": [ { "type": "command", "command": "say hi" } ] } ] },\n  "permissions": {"allow": ["Bash(ls)"]}\n}\n';
    writeFileSync(f, original);
    const r = installHooks(f, "claude");
    expect(readFileSync(r.backup!, "utf8")).toBe(original);
    const j = read(f);
    expect(j.hooks.Notification).toHaveLength(2);
    expect(j.hooks.Notification[0].hooks[0].command).toBe("say hi");
    expect(j.model).toBe("x");
    installHooks(f, "claude"); // twice: no duplicates
    expect(read(f).hooks.Notification).toHaveLength(2);
    expect(uninstallHooks(f).removed).toBe(2);
    expect(read(f)).toEqual(JSON.parse(original));
    expect(hooksInstalled(f)).toBe(false);
  });
  it("an existing backup is kept; the new one gets its own name", () => {
    const d = dir();
    const f = join(d, "settings.json");
    writeFileSync(f, "{}");
    writeFileSync(`${f}.agent-town.bak`, "OLD");
    const r = installHooks(f, "claude");
    expect(readFileSync(`${f}.agent-town.bak`, "utf8")).toBe("OLD");
    expect(r.backup).not.toBe(`${f}.agent-town.bak`);
    expect(existsSync(r.backup!)).toBe(true);
  });
  it("removes an event list that held only our entry", () => {
    const f = join(dir(), "settings.json");
    writeFileSync(f, "{}");
    installHooks(f, "claude");
    uninstallHooks(f);
    expect(read(f)).toEqual({});
  });
  it("refuses a damaged file and leaves it untouched", () => {
    const f = join(dir(), "settings.json");
    writeFileSync(f, "{ not json");
    expect(() => installHooks(f, "claude")).toThrow();
    expect(readFileSync(f, "utf8")).toBe("{ not json");
  });
});
