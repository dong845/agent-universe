// The faction marks (D21): Claude's spark and OpenAI's blossom, from their own SVGs (art/logos/, from
// Wikimedia Commons). Labels draw the SVG paths; the 3D scene draws the solid emblems Blender builds
// from the same files (scripts/models/emblems.py → public/models/emblems.glb). The marks belong to
// Anthropic and OpenAI and only label each side in this local tool.
import type { Faction } from "../../../schema/src/event.ts";
import claudeSvg from "../../../../art/logos/claude.svg?raw";
import openaiSvg from "../../../../art/logos/openai.svg?raw";

export const EMBLEMS_URL = "/models/emblems.glb";

export interface Mark {
  viewBox: string;
  paths: string[];
}

function parse(svg: string, name: string): Mark {
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1];
  const paths = [...svg.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
  if (!viewBox || !paths.length) throw new Error(`${name}: no viewBox or no path`);
  return { viewBox, paths };
}

export const MARKS: Record<Faction, Mark> = { "claude-code": parse(claudeSvg, "claude.svg"), codex: parse(openaiSvg, "openai.svg") };
/** the glTF node holding each faction's solid emblem */
export const EMBLEM_NODE: Record<Faction, string> = { "claude-code": "E_claude-code", codex: "E_codex" };
