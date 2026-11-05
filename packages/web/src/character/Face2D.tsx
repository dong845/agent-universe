// The character's 2D face in the page (spec 2026-11-05 A6): a thin wrapper around faceSvg.
import { useMemo } from "react";
import type { Faction } from "../../../schema/src/event.ts";
import { faceSvg } from "./faceSvg.ts";
import type { Face, Prop } from "./rules.ts";

export function Face2D(p: { face: Face; faction: Faction; size: number; accent?: string; prop?: Prop | null; className?: string }) {
  const svg = useMemo(() => faceSvg(p), [p.face, p.faction, p.size, p.accent, p.prop]);
  return <span className={`face2d${p.className ? ` ${p.className}` : ""}`} style={{ width: p.size, height: p.size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}
