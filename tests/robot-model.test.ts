// The agent model (spec 2026-11-05 A1/A3/A4): the nodes the page animates and switches must be in the GLB.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FACES, PROPS } from "../packages/web/src/character/rules.ts";

const glb = readFileSync(new URL("../packages/web/public/models/robot.glb", import.meta.url));
const json = (() => {
  if (glb.readUInt32LE(0) !== 0x46546c67) throw new Error("robot.glb is not a GLB");
  const len = glb.readUInt32LE(12);
  if (glb.readUInt32LE(16) !== 0x4e4f534a) throw new Error("robot.glb: first chunk is not JSON");
  return JSON.parse(glb.subarray(20, 20 + len).toString("utf8")) as { nodes: { name?: string }[]; meshes: { primitives: { indices?: number }[] }[]; accessors: { count: number }[]; materials: { name?: string }[] };
})();
const names = new Set(json.nodes.map((n) => n.name));

describe("robot.glb", () => {
  it("has the moving parts", () => {
    for (const n of ["Robot", "Body", "Head", "ArmL", "ArmR", "FootL", "FootR"]) expect(names, n).toContain(n);
  });
  it("has one face group per face", () => {
    for (const f of FACES) expect(names, f).toContain(`Face_${f}`);
  });
  it("has every prop, on the head, the hand or the body", () => {
    for (const p of PROPS) expect([`PropHead_${p}`, `PropHand_${p}`, `PropBody_${p}`].some((n) => names.has(n)), p).toBe(true);
  });
  it("names the materials the page recolours", () => {
    const mats = new Set(json.materials.map((m) => m.name));
    for (const m of ["Eye", "Phones", "Chest", "Red"]) expect(mats, m).toContain(m);
  });
  it("stays light enough to draw a dozen at once", () => {
    let tris = 0;
    for (const m of json.meshes) for (const p of m.primitives) if (p.indices !== undefined) tris += json.accessors[p.indices].count / 3;
    expect(tris).toBeLessThan(60_000);
  });
});
