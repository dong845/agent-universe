// "需要你": the live sessions waiting on the owner (spec 2026-11-01 A4), newest-most-urgent first. A row
// flies to its town and opens the request; "复制恢复命令" copies the command that reopens the session.
import { useEffect, useState } from "react";
import { create } from "zustand";
import type { Attention, AttentionState } from "../../../schema/src/attention.ts";
import { resumeCommand } from "../../../schema/src/resume.ts";
import { Badge } from "../galaxy/GalaxyApp.tsx";
import { useStore } from "../store.ts";

export const STATE_TEXT: Record<AttentionState, string> = { "maybe-waiting": "可能在等你授权", waiting: "在等你授权", "turn-done": "本轮完成，等你回复", error: "出错停止" };

const useToast = create<{ msg: string | null; show(m: string): void }>((set) => {
  let t: ReturnType<typeof setTimeout> | null = null;
  return {
    msg: null,
    show(m) {
      if (t) clearTimeout(t);
      set({ msg: m });
      t = setTimeout(() => set({ msg: null }), 1800);
    },
  };
});
export const toast = (m: string) => useToast.getState().show(m);

export function Toast() {
  const msg = useToast((s) => s.msg);
  return msg ? <div className="g-toast" role="status">{msg}</div> : null;
}

/** copies the resume command for a session; the folder comes from the request it was working on */
export async function copyResume(faction: Attention["faction"], sessionId: string, cwd?: string) {
  const cmd = resumeCommand(faction, sessionId, cwd);
  try {
    await navigator.clipboard.writeText(cmd);
    toast("已复制恢复命令");
  } catch {
    toast(`复制失败，请手动复制：${cmd}`);
  }
}

const ago = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} 秒前` : ms < 3_600_000 ? `${Math.round(ms / 60_000)} 分钟前` : `${Math.round(ms / 3_600_000)} 小时前`);

export function NeedsYou() {
  const list = useStore((s) => s.attention);
  const w = useStore((s) => s.w25);
  const diaryOpen = useStore((s) => !!s.selected);
  const [, tick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(i);
  }, []);
  if (!list.length) return null;
  const now = Date.now();
  return (
    <div className={`g-needs${diaryOpen ? " beside-diary" : ""}`} data-testid="needs-you">
      <header>需要你 · {list.length}</header>
      {list.map((a) => {
        const key = `${a.faction}|${a.projectId}`;
        const town = w?.towns.get(key);
        const req = a.requestId ? w?.requests.get(a.requestId) : undefined;
        const open = () => {
          const st = useStore.getState();
          if (st.city && st.city !== key) st.setCity(null);
          if (town) st.setFocus(key);
          if (req) st.select({ kind: "request", district: key, requestId: req.requestId });
        };
        return (
          <div key={a.session} className={`g-need s-${a.state}`} data-testid="needs-row" data-town={key}>
            <button className="g-need-open" onClick={open} title="飞到这个小镇，打开这次请求">
              <Badge f={a.faction} />
              <b>{town?.name ?? a.projectId.split("/").filter(Boolean).pop() ?? a.projectId}</b>
              <span className="g-need-state">{STATE_TEXT[a.state]}{a.tool ? ` · ${a.tool}` : ""}</span>
              <span className="g-need-ago">{ago(now - a.since)}</span>
            </button>
            <button className="g-need-copy" onClick={() => void copyResume(a.faction, a.sessionId, req?.cwd)}>复制恢复命令</button>
          </div>
        );
      })}
    </div>
  );
}
