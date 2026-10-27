// One material component for the whole world, so a look changes every surface at once.
import { useMemo, type Ref } from "react";
import { DataTexture, NearestFilter, RedFormat, type Material } from "three";
import { useLook } from "./looks.ts";

/** three hard bands for the cel-shaded look */
function toonRamp(): DataTexture {
  const t = new DataTexture(new Uint8Array([90, 170, 255]), 3, 1, RedFormat);
  t.minFilter = t.magFilter = NearestFilter;
  t.needsUpdate = true;
  return t;
}
let ramp: DataTexture | null = null;

export function Mat({ color, emissive, glow = 0, opacity, ref }: { color: string; emissive?: string; glow?: number; opacity?: number; ref?: Ref<Material> }) {
  const look = useLook();
  const transparent = opacity !== undefined && opacity < 1;
  const gradientMap = useMemo(() => (ramp ??= toonRamp()), []);
  if (look.shading === "toon") {
    return <meshToonMaterial ref={ref as Ref<never>} color={color} gradientMap={gradientMap} emissive={emissive ?? "#000"} emissiveIntensity={glow} transparent={transparent} opacity={opacity ?? 1} />;
  }
  return (
    <meshStandardMaterial
      ref={ref as Ref<never>}
      color={color}
      roughness={look.shading === "faceted" ? 0.95 : 0.78}
      metalness={0}
      flatShading={look.shading === "faceted"}
      emissive={emissive ?? "#000"}
      emissiveIntensity={glow}
      transparent={transparent}
      opacity={opacity ?? 1}
    />
  );
}
