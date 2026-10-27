// Light, atmosphere and post-processing for the active look.
import { Bloom, EffectComposer, HueSaturation, N8AO, SMAA, TiltShift2, Vignette } from "@react-three/postprocessing";
import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { Color, Fog } from "three";
import { useLook } from "./looks.ts";

export function Lights() {
  const look = useLook();
  const { hemi, sun, fill } = look.light;
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    scene.fog = look.fog ? new Fog(new Color(look.fog.color), look.fog.near, look.fog.far) : null;
  }, [scene, look]);
  return (
    <>
      <hemisphereLight args={[hemi[0], hemi[1], hemi[2]]} />
      <directionalLight
        castShadow
        color={sun.color}
        intensity={sun.intensity}
        position={sun.pos}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
        shadow-camera-far={80}
      />
      {fill ? <directionalLight color={fill.color} intensity={fill.intensity} position={fill.pos} /> : null}
    </>
  );
}

export function Post() {
  const { post } = useLook();
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <N8AO aoRadius={1.4} distanceFalloff={0.8} intensity={post.ao} halfRes quality="medium" />
      <Bloom intensity={post.bloom} luminanceThreshold={0.85} luminanceSmoothing={0.2} mipmapBlur />
      <TiltShift2 blur={post.tiltShift} taper={0.6} start={[0.5, 0.0]} end={[0.5, 1.0]} samples={6} />
      <HueSaturation saturation={post.saturation} />
      <Vignette offset={0.3} darkness={post.vignette} />
      <SMAA />
    </EffectComposer>
  );
}
