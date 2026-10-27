import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useStore } from "./store.ts";
import { HoverCard } from "./ui/HoverCard.tsx";
import { Hud, TimelineBar } from "./ui/Chrome.tsx";
import { Buildings, Hall } from "./world/Buildings.tsx";
import { Cubes } from "./world/Cubes.tsx";
import { Figures } from "./world/Figures.tsx";
import { LabelProjector, ScreenLabels } from "./world/Labels.tsx";
import { LOOKS } from "./world/looks.ts";
import { Lights, Post } from "./world/Stage.tsx";
import { Terrain } from "./world/Terrain.tsx";
import { Scaffolds, Site } from "./world/Site.tsx";

/** advances the playback clock once per rendered frame */
function Clock() {
  useFrame((_, dt) => useStore.getState().advance(Math.min(dt, 0.1) * 1000));
  return null;
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
  const look = LOOKS[useStore((s) => s.look)];
  return (
    <div
      className={`app ${look.labelClass}`}
      style={{ background: look.sky }}
      onPointerMove={(e) => useStore.getState().setPointer(e.clientX, e.clientY)}
    >
      <Canvas shadows orthographic gl={{ alpha: true, antialias: false }} camera={{ position: [22, 24, 22], zoom: 30, near: 0.1, far: 300 }} dpr={[1, 2]}>
        <Lights />
        <Terrain />
        <Buildings />
        <Hall />
        <Site />
        <Scaffolds />
        <Figures />
        <Cubes />
        <Clock />
        <LabelProjector />
        <Post />
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
