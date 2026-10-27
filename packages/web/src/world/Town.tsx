// One town. Full detail (buildings, hall, figures, effects) only when the camera is close or the
// town has a live task; otherwise LiteTowns draws its massing with every other far town.
import type { Runtime } from "../store.ts";
import { Buildings, Hall } from "./Buildings.tsx";
import { Cubes } from "./Cubes.tsx";
import { DistrictContext } from "./districtContext.tsx";
import { Dressing } from "./Dressing.tsx";
import { Figures } from "./Figures.tsx";
import { Bursts } from "./FX.tsx";
import { Scaffolds, Site } from "./Site.tsx";
import { DistrictGround } from "./Terrain.tsx";

export function Town({ rt }: { rt: Runtime }) {
  const { origin } = rt.district;
  return (
    <DistrictContext.Provider value={rt}>
      <group position={[origin.x, 0, origin.z]}>
        <DistrictGround />
        <Buildings />
        <Hall />
        <Dressing />
        {rt.timeline ? (
          <>
            <Site />
            <Scaffolds />
            <Figures />
            <Cubes />
            <Bursts />
          </>
        ) : null}
      </group>
    </DistrictContext.Provider>
  );
}
