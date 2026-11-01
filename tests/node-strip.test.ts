// The server runs its TypeScript through node's type stripping (node scripts/serve.ts), which rejects
// syntax vitest's compiler accepts (parameter properties, enums, namespaces). Every server and schema
// module must load under plain node, or the real server dies at start while every unit test passes.
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const files = ["packages/server/src", "packages/schema/src", "packages/adapter-claude/src", "packages/adapter-codex/src"].flatMap((d) =>
  readdirSync(join(root, d)).filter((f) => f.endsWith(".ts")).map((f) => join(root, d, f)),
);

describe("server modules load under node's type stripping", () => {
  it.each(files.map((f) => [f.slice(root.length + 1), f]))("%s", (_rel, f) => {
    expect(() => execFileSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(f)})`], { stdio: "pipe" })).not.toThrow();
  });
});
