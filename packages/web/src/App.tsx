import { Canvas, useFrame } from "@react-three/fiber";
import { useStore } from "./store.ts";
import { Diary } from "./ui/Diary.tsx";
import { HoverCard } from "./ui/HoverCard.tsx";
import { Hud, Nav, TimelineBar } from "./ui/Chrome.tsx";
import { Labels25, LabelProjector25, useLabels } from "./v3/Labels25.tsx";
import { Camera25, VIEW, World25View } from "./v3/World25.tsx";
import { GalaxyApp, ViewSwitch } from "./galaxy/GalaxyApp.tsx";

/** advances the playback clock once per rendered frame */
function Clock() {
  useFrame((_, dt) => useStore.getState().advance(Math.min(dt, 0.1) * 1000));
  return null;
}

/** what every kind of thing in the world means (spec v3 5) */
function Legend() {
  return (
    <div className="legend" data-testid="legend">
      <b>怎么看</b>
      <div>岛 = 一个项目或技能公会 · 地标 = 这个镇的身份，随成品长大</div>
      <div>房子 = 一件主要成品（门口挂牌：齿轮=代码，卷轴=文档，画架=幻灯，画框=图片，胶片=影音，木箱=数据）</div>
      <div>帐篷 = 一次大的调查 · 告示板 = 问答次数 · 小改动只在街牌上计数</div>
      <div>公共建筑 = 这里发生过的一类工作（数字=次数）</div>
    </div>
  );
}

const Q = new URLSearchParams(location.search);
const DPR: [number, number] = Q.has("dpr") ? [1, Number(Q.get("dpr"))] : [1, 2];
const C = VIEW.clone().multiplyScalar(1000);

export function App() {
  return Q.get("view") === "galaxy" ? <GalaxyApp /> : <TownApp />;
}

function TownApp() {
  const source = useStore((s) => s.source);
  const w = useStore((s) => s.w25);
  const labels = useLabels(w);
  return (
    <div className="app" style={{ background: "#cfe6e4" }} onPointerMove={(e) => useStore.getState().setPointer(e.clientX, e.clientY)}>
      <Canvas orthographic gl={{ antialias: true }} camera={{ position: [C.x, C.y, C.z], zoom: 1, near: 1, far: 5000 }} dpr={DPR}>
        {w ? (
          <>
            <World25View w={w} />
            <Camera25 w={w} />
            <LabelProjector25 labels={labels} />
          </>
        ) : null}
        <Clock />
      </Canvas>
      <Labels25 labels={labels} />
      <Hud />
      <div className="demo-badge" data-testid="source-badge">{source === "real" ? "真实数据 · 仅本机" : "演示数据：模拟的世界与任务，不是你的真实会话"}</div>
      <Nav />
      <ViewSwitch to="galaxy" />
      <Legend />
      <HoverCard />
      <Diary />
      <TimelineBar />
    </div>
  );
}
