import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { watchRoots } from "../packages/server/src/watch.ts";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("watchRoots", () => {
  it("watchRoots fires once per burst of log writes", async () => {
    const root = mkdtempSync(join(tmpdir(), "at-watch-"));
    mkdirSync(join(root, "p"), { recursive: true });
    let calls = 0;
    const stop = watchRoots([root, join(root, "missing")], () => calls++, 300);
    await wait(100);
    for (let i = 0; i < 3; i++) writeFileSync(join(root, "p", `s${i}.jsonl`), "{}\n");
    writeFileSync(join(root, "p", "notes.txt"), "x"); // not a log
    await wait(900);
    stop();
    expect(calls).toBe(1);
  });
  it("ignores files that are not logs", async () => {
    const root = mkdtempSync(join(tmpdir(), "at-watch-"));
    let calls = 0;
    const stop = watchRoots([root], () => calls++, 200);
    await wait(100);
    writeFileSync(join(root, "a.txt"), "x");
    await wait(600);
    stop();
    expect(calls).toBe(0);
  });
});
