// A first visit's short tour (spec 2026-11-03 C4): what the star, planets, panels, cities, robots,
// 需要你 and 历史 mean. A small card beside the scene — it never blocks it — skippable, remembered.
import { useState } from "react";

const KEY = "agent-universe:tour-done";
const STEPS: { title: string; text: string }[] = [
  { title: "欢迎来到智能体宇宙", text: "这里是你用 Claude Code 和 Codex 做过的事。全部从你电脑上的日志读出来，只在本机显示。" },
  { title: "两颗恒星", text: "左边是 Claude Code，右边是 Codex。围着恒星的戴森壳，每亮一片代表一件完成的成品。" },
  { title: "行星 = 项目", text: "每个项目（或技能公会）是一颗行星，成品越多越大。点一颗行星，飞过去、进城。" },
  { title: "城市和机器人", text: "城里的方楼是成品，圆塔是一类工作（读代码、跑命令……）。小机器人是正在干活的代理，小一号的是子代理。" },
  { title: "需要你", text: "右上角的「需要你」列出在等你的会话：可能在等授权、出错停止、本轮完成。设置里可以打开系统通知和精确提醒。" },
  { title: "历史", text: "没有在进行的城市会打开「历史」：每一步是一次请求，选中一步，城市停在它完成的那一刻。" },
];

const done = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

export function Tour() {
  const [i, setI] = useState(() => (done() ? -1 : 0));
  if (i < 0) return null;
  const close = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      // storage blocked: the tour shows again next time
    }
    setI(-1);
  };
  const s = STEPS[i];
  return (
    <div className="g-tour" data-testid="tour" role="dialog" aria-label="引导">
      <small>{i + 1} / {STEPS.length}</small>
      <b>{s.title}</b>
      <p>{s.text}</p>
      <div>
        <button onClick={close} data-testid="tour-skip">跳过</button>
        {i > 0 ? <button onClick={() => setI(i - 1)}>上一步</button> : null}
        {i < STEPS.length - 1 ? <button className="primary" onClick={() => setI(i + 1)} data-testid="tour-next">下一步</button> : <button className="primary" onClick={close}>开始</button>}
      </div>
    </div>
  );
}
