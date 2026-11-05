// Share mode in the page (spec 2026-11-01 B1): the world the page draws is swapped for a masked copy —
// code names for towns, request kinds for titles, numbered streets for folder names — with the same keys
// and layouts, so nothing moves. Whatever any label, card or list reads comes from this copy.
import { maskedTitle } from "../../../schema/src/share.ts";
import type { World25 } from "../v3/world25Data.ts";
import { t, useLang } from "../i18n/index.ts";

/** names: code names per town (null = keep project names); titles: keep request titles */
export function maskWorld(w: World25, names: Record<string, string> | null, titles: boolean): World25 {
  const towns = names ? new Map([...w.towns].map(([k, t]) => [k, { ...t, name: names[k] ?? "?", guildOf: [], skillNote: undefined }])) : w.towns;
  const requests = new Map([...w.requests].map(([k, r]) => [k, { ...r, title: titles ? r.title : maskedTitle(r, useLang.getState().lang), asked: titles ? r.asked : undefined, gist: titles ? r.gist : undefined, skills: names ? [] : r.skills, cwd: undefined }]));
  const layouts = names ? new Map([...w.layouts].map(([k, l]) => [k, { ...l, streets: l.streets.map((s, i) => ({ ...s, name: t("share.streetN", { n: i + 1 }) })) }])) : w.layouts;
  return { ...w, towns, requests, layouts };
}

const STARS = ["Kepler", "Gliese", "Vega", "Lyra", "Orion", "Cygnus", "Draco", "Rigel", "Altair", "Sirius", "Deneb", "Carina"];
/** demo data has nothing to hide and no server secret: a plain hash stands in for the code names */
export function demoCodeNames(keys: Iterable<string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    let h = 2166136261;
    for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 16777619) >>> 0;
    out[k] = `${STARS[h % STARS.length]}-${10 + ((h >>> 8) % 90)}${"abcdefgh"[(h >>> 16) % 8]}`;
  }
  return out;
}
