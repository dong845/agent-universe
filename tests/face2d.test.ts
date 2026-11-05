// The 2D face (spec 2026-11-05 A6): the same character as the 3D model, drawn from art/character.json.
import { describe, expect, it } from "vitest";
import { FACES } from "../packages/web/src/character/rules.ts";
import { faceSvg } from "../packages/web/src/character/faceSvg.ts";
import { FACTION_COLOR } from "../packages/web/src/galaxy/galaxyData.ts";

const draw = faceSvg;

describe("faceSvg", () => {
  it("draws every face as an svg, eyes in the faction colour", () => {
    for (const face of FACES) {
      const svg = draw({ face, faction: "codex", size: 40 });
      expect(svg.startsWith("<svg"), face).toBe(true);
      expect(svg, face).toContain(face === "error" ? "#ff4d4d" : FACTION_COLOR.codex);
      expect(svg, face).toContain(`data-face="${face}"`);
    }
  });
  it("red only for an error", () => {
    expect(draw({ face: "normal", faction: "claude-code", size: 40 })).not.toContain("#ff4d4d");
    expect(draw({ face: "error", faction: "claude-code", size: 40 })).toContain("#ff4d4d");
  });
  it("normal and happy look different", () => {
    const eyes = (s: string) => s.slice(s.indexOf('data-part="eyes"'), s.indexOf('data-part="mouth"'));
    expect(eyes(draw({ face: "normal", faction: "codex", size: 40 }))).not.toBe(eyes(draw({ face: "happy", faction: "codex", size: 40 })));
  });
  it("a prop badge only when there is a prop", () => {
    expect(draw({ face: "normal", faction: "codex", size: 40 })).not.toContain('data-part="prop"');
    expect(draw({ face: "normal", faction: "codex", size: 40, prop: "magnifier" })).toContain('data-part="prop"');
  });
});
