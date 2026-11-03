// One command for someone who just cloned the repository (spec 2026-11-03 C3): the launcher decides
// what is missing — a Node new enough, the dependencies, a current build — and says so plainly.
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nodeOk, needsBuild, needsInstall } from "../scripts/start.mjs";

const touch = (p: string, secondsAgo: number) => {
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, "x");
  const t = Date.now() / 1000 - secondsAgo;
  utimesSync(p, t, t);
};

describe("launcher checks", () => {
  it("Node: 22.18 or newer (TypeScript runs directly)", () => {
    expect(nodeOk("v22.18.0")).toBe(true);
    expect(nodeOk("v24.1.0")).toBe(true);
    expect(nodeOk("v22.6.0")).toBe(false);
    expect(nodeOk("v20.11.1")).toBe(false);
  });
  it("installs when node_modules is missing or older than the lockfile", () => {
    const d = mkdtempSync(join(tmpdir(), "at-start-"));
    touch(join(d, "pnpm-lock.yaml"), 100);
    expect(needsInstall(d)).toBe(true);
    touch(join(d, "node_modules", ".modules.yaml"), 50);
    expect(needsInstall(d)).toBe(false);
    touch(join(d, "pnpm-lock.yaml"), 10);
    expect(needsInstall(d)).toBe(true);
  });
  it("builds when there is no build or a source file is newer than it", () => {
    const d = mkdtempSync(join(tmpdir(), "at-start-"));
    touch(join(d, "packages", "web", "src", "a.tsx"), 100);
    expect(needsBuild(d)).toBe(true);
    touch(join(d, "packages", "web", "dist", "index.html"), 50);
    expect(needsBuild(d)).toBe(false);
    touch(join(d, "packages", "schema", "src", "b.ts"), 10);
    expect(needsBuild(d)).toBe(true);
  });
});
