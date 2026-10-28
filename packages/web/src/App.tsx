import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useStore } from "./store.ts";
import { Diary } from "./ui/Diary.tsx";
import { HoverCard } from "./ui/HoverCard.tsx";
import { Hud, Nav, TimelineBar } from "./ui/Chrome.tsx";
import { CameraRig, DetailTracker } from "./world/Camera.tsx";
import { LabelProjector, ScreenLabels } from "./world/Labels.tsx";
import { LOOKS } from "./world/looks.ts";
import { Lights, Post } from "./world/Stage.tsx";
import { Town } from "./world/Town.tsx";
import { LiteTowns, WorldScenery } from "./world/World.tsx";

/** advances the playback clock once per rendered frame */
function Clock() {
  useFrame((_, dt) => useStore.getState().advance(Math.min(dt, 0.1) * 1000));
  return null;
}

/** full-detail towns from the tracker; every other town is far massing */
function Towns() {
  const runtimes = useStore((s) => s.runtimes);
  const detail = useStore((s) => s.detail);
  return (
    <>
      {runtimes.filter((r) => detail.has(r.district.key)).map((r) => (
        <Town key={r.district.key} rt={r} />
      ))}
      <LiteTowns keys={detail} />
    </>
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

// profiling switches: ?dpr=1 ?post=0 ?shadow=0
const Q = new URLSearchParams(location.search);
const DPR: [number, number] = Q.has("dpr") ? [1, Number(Q.get("dpr"))] : [1, 2];

export function App() {
  const look = LOOKS[useStore((s) => s.look)];
  const source = useStore((s) => s.source);
  return (
    <div
      className={`app ${look.labelClass}`}
      style={{ background: look.sky }}
      onPointerMove={(e) => useStore.getState().setPointer(e.clientX, e.clientY)}
    >
      {/* 5× the old offset from the controls' target (0,0,8): the same orthographic view, and a big world never crosses the near plane */}
      <Canvas shadows={Q.get("shadow") !== "0"} orthographic gl={{ alpha: true, antialias: false }} camera={{ position: [700, 750, 708], zoom: 4, near: 1, far: 6000 }} dpr={DPR}>
        <Lights />
        <WorldScenery />
        <Towns />
        <Clock />
        <LabelProjector />
        <CameraRig />
        <DetailTracker />
        {Q.get("post") === "0" ? null : <Post />}
        <OrbitControls makeDefault target={[0, 0, 8]} enableDamping maxPolarAngle={Math.PI / 2.3} minZoom={0.8} maxZoom={90} />
      </Canvas>
      <ScreenLabels />
      <Hud />
      <div className="demo-badge" data-testid="source-badge">{source === "real" ? "真实数据 · 仅本机" : "演示数据：模拟的世界与任务，不是你的真实会话"}</div>
      <Nav />
      <Legend />
      <HoverCard />
      <Diary />
      <TimelineBar />
    </div>
  );
}
