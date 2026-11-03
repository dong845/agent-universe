// The settings panel (spec 2026-11-01 A3/A5): notification switches and the optional precise hooks,
// which write the agent's own hook file — so the switch says which file, and that a backup is kept.
import { useEffect, useState } from "react";
import { useStore } from "../store.ts";
import { useRightPanel } from "./rightPanel.ts";
import { officialMarks } from "../galaxy/emblem.ts";

interface ServerSettings { notify: boolean; notifyTurnDone: boolean; hooks: { claude: boolean; codex: boolean }; hookFiles?: { claude: string; codex: string } }

const post = async (path: string, body: unknown) => {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `${r.status}`);
  return j;
};

export function Settings() {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<ServerSettings | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const side = useRightPanel() ? " beside-diary" : "";
  const logosOn = useStore((st) => Object.keys(st.logos).length > 0);
  const [busy, setBusy] = useState(false);
  const logos = async () => {
    setBusy(true);
    try {
      await post("/api/logos", { on: !logosOn });
      const l = await (await fetch("/api/logos")).json();
      useStore.getState().setLogos(officialMarks(l));
      setNote(logosOn ? "已删除本机的官方标志，改用中性标志" : "已下载官方标志到本机");
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const refresh = () => fetch("/api/settings").then((r) => r.json()).then(setS).catch(() => setNote("读不到设置：本地服务没有响应"));
  useEffect(() => {
    if (open) void refresh();
  }, [open]);
  const flip = async (k: "notify" | "notifyTurnDone") => {
    if (!s) return;
    setS(await post("/api/settings", { [k]: !s[k] }));
  };
  const hooks = async (agent: "claude" | "codex") => {
    if (!s) return;
    try {
      const r = await post("/api/hooks", { agent, on: !s.hooks[agent] });
      setNote(r.on
        ? (r.added?.length ? `已在 ${r.file} 加入 ${r.added.join("、")} 两个 hook${r.backup ? `；原文件备份在 ${r.backup}` : ""}` : `${r.file} 里已经有 Agent Universe 的 hook`)
        : `已从 ${r.file} 移除 ${r.removed} 条 Agent Universe 的 hook，其余内容没动`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
    await refresh();
  };
  return (
    <>
      <button className={`g-gear${side}`} data-testid="settings" title="设置" onClick={() => setOpen(!open)}>⚙</button>
      {open && s ? (
        <div className={`g-settings${side}`} data-testid="settings-panel">
          <label><input type="checkbox" checked={s.notify} onChange={() => void flip("notify")} /> 系统通知（需要你时提醒）</label>
          <label><input type="checkbox" checked={s.notifyTurnDone} disabled={!s.notify} onChange={() => void flip("notifyTurnDone")} /> 本轮完成也通知</label>
          <hr />
          <p className="muted">默认靠日志猜“可能在等你授权”（超过 20 秒没结果的调用）。打开下面的开关可以精确知道：会在该工具自己的 hook 文件里加两条记录，先备份原文件，关掉即移除。</p>
          <label><input type="checkbox" checked={s.hooks.claude} onChange={() => void hooks("claude")} /> 精确授权提醒（安装 hook）· Claude Code<small>{s.hookFiles?.claude}</small></label>
          <label><input type="checkbox" checked={s.hooks.codex} onChange={() => void hooks("codex")} /> 精确授权提醒（安装 hook）· Codex<small>{s.hookFiles?.codex}</small></label>
          <hr />
          <label><input type="checkbox" checked={logosOn} disabled={busy} onChange={() => void logos()} data-testid="logos" /> 官方标志（仅本机显示）<small>从 Wikimedia Commons 下载 Claude 和 OpenAI 的标志，存在你自己的电脑里；关掉则用中性标志。导出的视频和分享页始终用中性标志。</small></label>
          {note ? <p className="g-settings-note">{note}</p> : null}
        </div>
      ) : null}
    </>
  );
}
