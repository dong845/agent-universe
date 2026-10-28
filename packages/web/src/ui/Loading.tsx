// The screen before the world: reading progress, or what to do when the local server is not running.
import type { Progress } from "../data.ts";

export function Loading({ p }: { p: Progress | null }) {
  return (
    <div className="loading" data-testid="loading">
      {p?.phase === "error" ? (
        <>
          <b>{p.message}</b>
          <span>开发时另开一个终端运行 node --run serve，再刷新本页</span>
        </>
      ) : (
        <>
          <b>正在读取本机日志 {p ? `${p.done}/${p.total}` : ""}</b>
          <span>第一次读取较慢；之后只重新读取有变化的会话</span>
        </>
      )}
    </div>
  );
}
