// The character's 2D face (spec 2026-11-05 A6): the same head, screen and expressions as the 3D model,
// drawn from art/character.json as an SVG string — used in the page (Face2D), the mini window and the
// review poster (drawn onto a canvas from a data URL).
import character from "../../../../art/character.json" with { type: "json" };
import type { Faction } from "../../../schema/src/event.ts";
import type { Face, Prop } from "./rules.ts";

const PROP_GLYPH: Record<Prop, string> = {
  magnifier: "🔍", pencil: "✏️", hardhat: "⛑️", glasses: "👓", dish: "📡", clipboard: "📋",
  beret: "🎨", goggles: "🥽", bowtie: "🎀", shield: "🛡️", backpack: "🎒",
};

interface FaceSpec { eyes: { shape: string; w: number; h: number; dx: number; dy: number; look?: number }; mouth: { shape: string; w: number }; red?: boolean }

const f1 = (n: number) => Math.round(n * 10) / 10;

/** an SVG of the head: `accent` colours the headphones (default: the faction's), `prop` adds a small badge */
export function faceSvg(o: { face: Face; faction: Faction; size: number; accent?: string; prop?: Prop | null }): string {
  const C = character.colors;
  const spec = (character.faces as Record<string, FaceSpec>)[o.face];
  if (!spec) throw new Error(`art/character.json has no face "${o.face}"`);
  const ink = spec.red ? C.red : C[o.faction];
  const phones = o.accent ?? C[o.faction];
  // the screen: 60 wide, centred at (50, 47); face sizes are in screen widths
  const U = 60, cx = 50, cy = 47;
  const e = spec.eyes;
  const eyes: string[] = [];
  for (const side of [-1, 1]) {
    const x = f1(cx + side * e.dx * U + (e.look ?? 0) * U), y = f1(cy - e.dy * U), w = f1(e.w * U), h = f1(e.h * U);
    if (e.shape === "round" || e.shape === "wide") {
      eyes.push(`<ellipse cx="${x}" cy="${y}" rx="${f1(w / 2)}" ry="${f1(h / 2)}" fill="${ink}"/>`, `<circle cx="${f1(x + w * 0.18)}" cy="${f1(y - h * 0.2)}" r="${f1(w * 0.16)}" fill="#fff"/>`);
    } else if (e.shape === "flat" || e.shape === "line") {
      eyes.push(`<rect x="${f1(x - w / 2)}" y="${f1(y - Math.max(h, 2.4) / 2)}" width="${w}" height="${f1(Math.max(h, 2.4))}" rx="${f1(Math.max(h, 2.4) / 2)}" fill="${ink}"/>`);
    } else if (e.shape === "arc") {
      eyes.push(`<path d="M${f1(x - w / 2)} ${f1(y + h / 2)} Q${x} ${f1(y - h)} ${f1(x + w / 2)} ${f1(y + h / 2)}" stroke="${ink}" stroke-width="3" fill="none" stroke-linecap="round"/>`);
    } else if (e.shape === "x") {
      eyes.push(`<path d="M${f1(x - w / 2)} ${f1(y - h / 2)}L${f1(x + w / 2)} ${f1(y + h / 2)}M${f1(x + w / 2)} ${f1(y - h / 2)}L${f1(x - w / 2)} ${f1(y + h / 2)}" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`);
    } else throw new Error(`unknown eye shape ${e.shape}`);
  }
  const m = spec.mouth, mw = f1(m.w * U), my = cy + 11;
  const mouth = m.shape === "smile" ? `<path d="M${f1(cx - mw / 2)} ${my} Q${cx} ${f1(my + mw * 0.55)} ${f1(cx + mw / 2)} ${my}" stroke="${ink}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`
    : m.shape === "flat" ? `<rect x="${f1(cx - mw / 2)}" y="${my}" width="${mw}" height="2.2" rx="1.1" fill="${ink}"/>`
    : m.shape === "o" ? `<circle cx="${cx}" cy="${my + 1}" r="${f1(mw / 2)}" stroke="${ink}" stroke-width="2" fill="none"/>` : "";
  const prop = o.prop ? `<g data-part="prop"><circle cx="82" cy="82" r="15" fill="#fff" stroke="${phones}" stroke-width="2.5"/><text x="82" y="88" font-size="17" text-anchor="middle">${PROP_GLYPH[o.prop]}</text></g>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${o.size}" height="${o.size}" data-face="${o.face}" role="img" aria-label="${o.face}">`
    + `<path d="M14 44 A36 36 0 0 1 86 44" stroke="${phones}" stroke-width="6" fill="none"/>`
    + `<line x1="50" y1="10" x2="50" y2="3" stroke="${C.ink}" stroke-width="2"/><circle cx="50" cy="4" r="3.5" fill="${C[o.faction]}"/>`
    + `<rect x="33" y="70" width="34" height="28" rx="14" fill="${C.shell}" stroke="${C.screen}" stroke-opacity="0.25"/>`
    + `<rect x="11" y="16" width="78" height="62" rx="24" fill="${C.shell}"/>`
    + `<rect x="5" y="36" width="11" height="24" rx="5" fill="${phones}"/><rect x="84" y="36" width="11" height="24" rx="5" fill="${phones}"/>`
    + `<rect x="20" y="25" width="60" height="44" rx="13" fill="${C.screen}"/>`
    + `<g data-part="eyes">${eyes.join("")}</g>`
    + `<g data-part="mouth">${mouth}</g>`
    + `<ellipse cx="27" cy="${my}" rx="4" ry="2.2" fill="${C.blush}" opacity="0.85"/><ellipse cx="73" cy="${my}" rx="4" ry="2.2" fill="${C.blush}" opacity="0.85"/>`
    + prop
    + `</svg>`;
}
