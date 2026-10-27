// Light, atmosphere and post-processing for the active look.
import { Bloom, EffectComposer, HueSaturation, N8AO, SMAA, TiltShift2, Vignette } from "@react-three/postprocessing";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Color, Fog, Vector3, type DirectionalLight, type OrthographicCamera } from "three";
import { useStore } from "../store.ts";
import { useLook } from "./looks.ts";

export function Lights() {
  const look = useLook();
  const { hemi, sun, fill } = look.light;
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera) as OrthographicCamera;
  const controls = useThree((s) => s.controls) as unknown as { target: Vector3 } | null;
  const size = useThree((s) => s.size);
  const light = useRef<DirectionalLight>(null);
  const dir = useMemo(() => new Vector3(...sun.pos).normalize(), [sun.pos]);
  // the shadow camera follows what is on screen and covers it, so shadows stay sharp up close
  useFrame(() => {
    const l = light.current;
    if (!l || !controls) return;
    const half = Math.min(170, Math.max(18, Math.hypot(size.width, size.height) / 2 / camera.zoom));
    l.position.copy(controls.target).addScaledVector(dir, 120);
    l.target.position.copy(controls.target);
    l.target.updateMatrixWorld();
    const c = l.shadow.camera;
    if (Math.abs(c.right - half) > 0.5) {
      c.left = -half;
      c.right = half;
      c.top = half;
      c.bottom = -half;
      c.far = 300;
      c.updateProjectionMatrix();
      // a texel covers more ground the wider the shadow camera: scale the bias with it, or wide
      // views get acne (light streaks across flat discs)
      l.shadow.normalBias = 0.02 + (half / 1024) * 6;
    }
  });
  useEffect(() => {
    scene.fog = look.fog ? new Fog(new Color(look.fog.color), look.fog.near, look.fog.far) : null;
  }, [scene, look]);
  return (
    <>
      <hemisphereLight args={[hemi[0], hemi[1], hemi[2]]} />
      <directionalLight
        ref={light}
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

/** profiling: ?fx=ao,bloom,tilt picks which post effects run (default all) */
const FX = new Set((new URLSearchParams(location.search).get("fx") ?? "ao,bloom,tilt").split(","));

export function Post() {
  const { post } = useLook();
  // ambient occlusion only up close: at world zoom it adds nothing and bands on large flat discs
  const near = useStore((s) => s.near);
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      {FX.has("ao") ? <N8AO aoRadius={1.4} distanceFalloff={0.8} intensity={near ? post.ao : 0} halfRes quality="low" /> : <></>}
      {FX.has("bloom") ? <Bloom intensity={post.bloom} luminanceThreshold={0.85} luminanceSmoothing={0.2} mipmapBlur /> : <></>}
      {FX.has("tilt") ? <TiltShift2 blur={post.tiltShift} taper={0.6} start={[0.5, 0.0]} end={[0.5, 1.0]} samples={6} /> : <></>}
      <HueSaturation saturation={post.saturation} />
      <Vignette offset={0.3} darkness={post.vignette} />
      <SMAA />
    </EffectComposer>
  );
}
