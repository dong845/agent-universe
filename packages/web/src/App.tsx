import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useStore } from "./store.ts";
import { HoverCard } from "./ui/HoverCard.tsx";
import { Hud, TimelineBar } from "./ui/Chrome.tsx";
import { Buildings, Hall } from "./world/Buildings.tsx";
import { Cubes } from "./world/Cubes.tsx";
import { Figures } from "./world/Figures.tsx";
import { LabelProjector, ScreenLabels } from "./world/Labels.tsx";
import { FACTION } from "./world/palette.ts";
import { Scaffolds, Site } from "./world/Site.tsx";

/** advances the playback clock once per rendered frame */
function Clock() {
  useFrame((_, dt) => useStore.getState().advance(Math.min(dt, 0.1) * 1000));
  return null;
}

function Ground() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 1]} receiveShadow>
        <circleGeometry args={[15, 64]} />
        <meshStandardMaterial color={FACTION.ground} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <circleGeometry args={[5.2, 48]} />
        <meshStandardMaterial color={FACTION.plaza} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.005, 7.5]} receiveShadow>
        <planeGeometry args={[1.6, 7]} />
        <meshStandardMaterial color={FACTION.plaza} />
      </mesh>
    </group>
  );
}

function Legend() {
  return (
    <div className="legend">
      <div><i className="sq c-input-bg" />输入 token</div>
      <div><i className="sq c-output-bg" />输出 token</div>
      <div><i className="sq c-cache-bg" />缓存读取</div>
      <div><i className="sq" style={{ background: "#16a34a" }} /><i className="sq" style={{ background: "#eab308" }} /><i className="sq" style={{ background: "#dc2626" }} />背包 = 上下文占用</div>
      <div><i className="dash" />虚线框 = 子代理</div>
      <div>灰烟 = 测试失败 · 乌云 = 返工</div>
    </div>
  );
}

export function App() {
  return (
    <div className="app" onPointerMove={(e) => useStore.getState().setPointer(e.clientX, e.clientY)}>
      <Canvas shadows orthographic camera={{ position: [22, 24, 22], zoom: 30, near: 0.1, far: 300 }} dpr={[1, 2]}>
        <color attach="background" args={["#f7f1e8"]} />
        <ambientLight intensity={0.75} />
        <directionalLight
          castShadow
          position={[12, 20, 8]}
          intensity={1.3}
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-18}
          shadow-camera-right={18}
          shadow-camera-top={18}
          shadow-camera-bottom={-18}
        />
        <Ground />
        <Buildings />
        <Hall />
        <Site />
        <Scaffolds />
        <Figures />
        <Cubes />
        <Clock />
        <LabelProjector />
        <OrbitControls makeDefault target={[0, 0, 2]} enableDamping maxPolarAngle={Math.PI / 2.3} minZoom={10} maxZoom={90} />
      </Canvas>
      <ScreenLabels />
      <Hud />
      <div className="demo-badge">演示数据：模拟的一次任务，不是你的真实会话</div>
      <Legend />
      <HoverCard />
      <TimelineBar />
    </div>
  );
}
