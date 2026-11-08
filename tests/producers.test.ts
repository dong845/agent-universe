// The cache key hashes the parser sources (D30 A3): the .ts file in a clone, the shipped .js in the package.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { producerFile } from "../packages/server/src/load.ts";

describe("producerFile", () => {
  const d = mkdtempSync(join(tmpdir(), "producers-"));
  mkdirSync(join(d, "a", "src"), { recursive: true });
  mkdirSync(join(d, "b", "src"), { recursive: true });
  writeFileSync(join(d, "a", "src", "index.ts"), "ts");
  writeFileSync(join(d, "b", "src", "index.js"), "js");
  const base = pathToFileURL(join(d, "x", "y.js"));
  it("the .ts source when it is there", () => expect(producerFile("../a/src/index.ts", base).pathname).toMatch(/a\/src\/index\.ts$/));
  it("else the shipped .js", () => expect(producerFile("../b/src/index.ts", base).pathname).toMatch(/b\/src\/index\.js$/));
  it("neither: an error naming the file", () => expect(() => producerFile("../c/src/index.ts", base)).toThrow(/c\/src\/index/));
});
