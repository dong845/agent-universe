// The faction marks. The official ones (Claude's spark, OpenAI's blossom — D21) are not in the
// repository (spec 2026-11-03 C2): the owner can download them from Wikimedia Commons into their own
// folder, and the page then draws them on this machine only — labels from the SVG paths, the solid 3D
// mark extruded from the same SVG in the browser. Without them, and in anything exported, the neutral
// marks below. The official marks belong to Anthropic and OpenAI.
import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import type { Faction } from "../../../schema/src/event.ts";

export interface Mark {
  viewBox: string;
  paths: string[];
}

/** a downloaded SVG's viewBox and paths (labels draw them) */
export function parseMark(svg: string): Mark | null {
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1];
  const paths = [...svg.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
  return viewBox && paths.length ? { viewBox, paths } : null;
}

const solid = new Map<string, THREE.BufferGeometry>();
/**
 * The solid mark from its SVG, as the Blender script made it (D21): extruded 9 % of its size, bevelled
 * 1.2 %, centred, its larger side 1, in the XY plane facing +Z.
 */
export function officialGeometry(svg: string): THREE.BufferGeometry {
  let g = solid.get(svg);
  if (g) return g;
  const data = new SVGLoader().parse(svg);
  const shapes = data.paths.flatMap((p) => SVGLoader.createShapes(p));
  const flat = new THREE.ShapeGeometry(shapes);
  flat.computeBoundingBox();
  const bb = flat.boundingBox!;
  const size = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y) || 1;
  flat.dispose();
  g = new THREE.ExtrudeGeometry(shapes, { depth: size * 0.09, bevelEnabled: true, bevelThickness: size * 0.012, bevelSize: size * 0.012, bevelSegments: 2, curveSegments: 10 });
  g.center();
  // SVG y points down
  g.scale(1 / size, -1 / size, 1 / size);
  g.computeVertexNormals();
  solid.set(svg, g);
  return g;
}

/** the official marks this machine has downloaded (none until the owner switches them on) */
export type OfficialMarks = Partial<Record<Faction, { mark: Mark; svg: string }>>;
export function officialMarks(files: { claude?: string; openai?: string }): OfficialMarks {
  const out: OfficialMarks = {};
  const add = (f: Faction, svg?: string) => {
    const mark = svg ? parseMark(svg) : null;
    if (svg && mark) out[f] = { mark, svg };
  };
  add("claude-code", files.claude);
  add("codex", files.openai);
  return out;
}

// ---- our own neutral emblems (D18), for anything that leaves this machine (spec 2026-11-01 B2) --------
// Claude Code a sunburst of rays, Codex three interlocked rings: simple shapes, not the logos. One
// geometry builder (3D) and one SVG path set (labels) per shape, from the same numbers.
const RAYS = 12;
/** rays from r0 to alternating long/short tips; widths taper towards the tip */
function rays(r0: number, long: number, short: number, w0: number, w1: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < RAYS; i++) {
    const a = (i / RAYS) * Math.PI * 2 + (i % 3 === 1 ? 0.06 : 0);
    const r1 = i % 2 ? short : long;
    const c = Math.cos(a), s = Math.sin(a), nx = -s, ny = c;
    out.push([c * r0 + nx * w0, s * r0 + ny * w0, c * r1 + nx * w1, s * r1 + ny * w1, c * r1 - nx * w1, s * r1 - ny * w1, c * r0 - nx * w0, s * r0 - ny * w0]);
  }
  return out;
}

/** three ellipses at 0°, 60° and 120°, as rings of a given thickness: [outer, inner] point loops */
function rings(rx: number, ry: number, th: number, n = 64): [number, number][][][] {
  const out: [number, number][][][] = [];
  for (let k = 0; k < 3; k++) {
    const rot = (k * Math.PI) / 3;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const outer: [number, number][] = [], inner: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * Math.PI * 2;
      const x = rx * Math.cos(t), y = ry * Math.sin(t);
      // the ellipse's outward normal
      let nx = Math.cos(t) / rx, ny = Math.sin(t) / ry;
      const l = Math.hypot(nx, ny);
      nx /= l; ny /= l;
      const o: [number, number] = [x + nx * th, y + ny * th], q: [number, number] = [x - nx * th, y - ny * th];
      outer.push([o[0] * cr - o[1] * sr, o[0] * sr + o[1] * cr]);
      inner.push([q[0] * cr - q[1] * sr, q[0] * sr + q[1] * cr]);
    }
    out.push([outer, inner]);
  }
  return out;
}

type EmblemUse = "badge" | "corona";

/** a flat emblem in the XY plane, about one unit across */
export function neutralEmblemGeometry(f: Faction, use: EmblemUse): THREE.BufferGeometry {
  const pos: number[] = [];
  if (f === "claude-code") {
    const rs = use === "corona" ? rays(0.7, 1.0, 0.86, 0.05, 0.012) : rays(0.16, 1.0, 0.78, 0.075, 0.035);
    for (const q of rs) pos.push(q[0], q[1], 0, q[2], q[3], 0, q[4], q[5], 0, q[0], q[1], 0, q[4], q[5], 0, q[6], q[7], 0);
  } else {
    const rr = use === "corona" ? rings(1.0, 0.38, 0.012) : rings(0.95, 0.4, 0.07);
    for (const [o, q] of rr) for (let i = 0; i < o.length - 1; i++) pos.push(o[i][0], o[i][1], 0, o[i + 1][0], o[i + 1][1], 0, q[i + 1][0], q[i + 1][1], 0, o[i][0], o[i][1], 0, q[i + 1][0], q[i + 1][1], 0, q[i][0], q[i][1], 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/** the same badge as SVG paths in a 24×24 box (fill-rule evenodd, one path per ring) */
export function neutralEmblemPaths(f: Faction): string[] {
  const m = (x: number, y: number) => `${(12 + x * 11).toFixed(2)} ${(12 - y * 11).toFixed(2)}`;
  if (f === "claude-code") return [rays(0.16, 1.0, 0.78, 0.075, 0.035).map((q) => `M${m(q[0], q[1])}L${m(q[2], q[3])}L${m(q[4], q[5])}L${m(q[6], q[7])}Z`).join("")];
  return rings(0.95, 0.4, 0.07, 48).map(([o, q]) => `M${o.map(([x, y]) => m(x, y)).join("L")}Z M${q.map(([x, y]) => m(x, y)).join("L")}Z`);
}

/** the neutral marks as label badges (fill-rule evenodd) */
export const NEUTRAL_MARKS: Record<Faction, Mark> = { "claude-code": { viewBox: "0 0 24 24", paths: neutralEmblemPaths("claude-code") }, codex: { viewBox: "0 0 24 24", paths: neutralEmblemPaths("codex") } };
