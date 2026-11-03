// "导出分享页" (spec 2026-11-01 D): one HTML file of this world that others can open and turn. Names are
// hidden unless switched on; up to 5 requests can go along as replays.
import { useMemo, useState } from "react";
import { useStore } from "../store.ts";
import { useRightPanel } from "../ui/rightPanel.ts";
import { toast } from "../ui/NeedsYou.tsx";

const MAX_REPLAYS = 5;

export function ExportShare() {
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState(true);
  const [titles, setTitles] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const w = useStore((s) => s.w25);
  const side = useRightPanel() ? " beside-diary" : "";
  // the most recent finished products, the ones worth showing
  const recent = useMemo(() => [...(w?.requests.values() ?? [])].filter((r) => r.class === "produced" && r.ok !== null).sort((a, b) => b.endTs - a.endTs).slice(0, 12), [w]);
  const go = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/export/share", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ townNames: names, titles, replays: picked }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `${r.status}`);
      const blob = await r.blob();
      const name = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? "agent-universe-share.html";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
      toast(`已保存 ${name}（${(blob.size / 1e6).toFixed(1)} MB${blob.size > 15e6 ? "，偏大" : ""}）`);
      setOpen(false);
    } catch (e) {
      toast(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button className={`g-export${side}`} data-testid="export-share" onClick={() => setOpen(!open)} title="把这个世界导出成一个网页文件，发给别人打开">⇪ 导出分享页</button>
      {open ? (
        <div className="g-rec-dialog g-export-dialog" data-testid="export-dialog" role="dialog" aria-label="导出分享页">
          <b>导出分享页</b>
          <p className="muted">一个离线 HTML 文件：别人打开就能转动你的星系、进城看看。不带日志原文、路径和会话编号，用我们自己的阵营标志。</p>
          <label><input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} /> 显示项目名称<small>关掉则用代号</small></label>
          <label><input type="checkbox" checked={titles} onChange={(e) => setTitles(e.target.checked)} /> 显示请求标题<small>你自己写的话会写进文件</small></label>
          <p className="muted">带上几次重放（最多 {MAX_REPLAYS} 个，只含动作的种类和时间）：</p>
          <div className="g-export-list">
            {recent.map((r) => (
              <label key={r.requestId}>
                <input type="checkbox" checked={picked.includes(r.requestId)} disabled={!picked.includes(r.requestId) && picked.length >= MAX_REPLAYS}
                  onChange={(e) => setPicked(e.target.checked ? [...picked, r.requestId] : picked.filter((x) => x !== r.requestId))} />
                <span>{w?.towns.get(`${r.faction}|${r.projectId}`)?.name} · {r.title ?? "（无标题）"}</span>
              </label>
            ))}
          </div>
          <div className="g-rec-actions">
            <button onClick={() => setOpen(false)}>取消</button>
            <button className="primary" disabled={busy} data-testid="export-go" onClick={() => void go()}>{busy ? "正在生成…" : "导出"}</button>
          </div>
        </div>
      ) : null}
    </>
  );
}
