// The decision panel's state and answers (spec 2026-11-05 D26 B3): what is pending (from the server's held
// hooks), which session's decision is open, the page's token, and the answer for a question with options:
// keyed by the question's text, several labels joined with ", ", one's own words replacing the options.
import { create } from "zustand";
import type { Attention } from "../../../schema/src/attention.ts";
import type { AskQuestion } from "../../../schema/src/event.ts";

export interface PendingAsk {
  id: string;
  src: "claude" | "codex";
  session: string;
  sessionId: string;
  tool: string;
  kind: "question" | "approval";
  questions?: AskQuestion[];
  summary?: string;
  cwd?: string;
  since: number;
}
/** 需要你's entries plus a row for each held question or approval whose session has none yet (a session
 * whose log the server has not read, a project not yet a town) */
export function withAsks(list: Attention[], asks: readonly PendingAsk[]): Attention[] {
  const extra = asks
    .filter((a) => !list.some((x) => x.session === a.session))
    .map((a): Attention => ({
      session: a.session, faction: a.src === "claude" ? "claude-code" : "codex", sessionId: a.sessionId, projectId: a.cwd ?? "", requestId: null,
      state: "waiting", since: a.since, tool: a.tool, exact: true, ...(a.questions ? { ask: a.questions } : {}),
    }));
  return [...list, ...extra];
}

export type Picks = Record<string, { labels: string[]; other?: string }>;

type Q = Pick<AskQuestion, "question"> & { multiSelect?: boolean };
/** one question's answer: a single choice or the Other text; for multi-select every label and the text (D27 D1) */
const said = (q: Q, p: { labels: string[]; other?: string } | undefined) => {
  const other = p?.other?.trim() ?? "";
  const labels = p?.labels ?? [];
  if (q.multiSelect) return [...labels, ...(other ? [other] : [])].join(", ");
  return other || labels.join(", ");
};

export function answerOf(questions: readonly Q[], picks: Picks): Record<string, string> {
  return Object.fromEntries(questions.map((q) => [q.question, said(q, picks[q.question])]));
}
export const complete = (questions: readonly Q[], picks: Picks) => questions.every((q) => !!said(q, picks[q.question]));

type HookSides = { "claude-code": boolean; codex: boolean };
export const useDecision = create<{ asks: PendingAsk[]; open: string | null; token: string | null; askHooks: HookSides | null; setAsks(a: PendingAsk[]): void; show(session: string | null): void; setToken(t: string | null): void; setAskHooks(h: HookSides | null): void }>((set) => ({
  asks: [],
  open: null,
  token: null,
  askHooks: null,
  setAsks: (asks) => set({ asks }),
  show: (open) => set({ open }),
  setToken: (token) => set({ token }),
  setAskHooks: (askHooks) => set({ askHooks }),
}));

/** whether each side's ask hook is installed (D27 B4); null when there is no server to ask */
export async function refreshAskHooks() {
  try {
    const r = await fetch("/api/settings");
    const s = (await r.json()) as { askHooks?: { claude?: boolean; codex?: boolean } };
    useDecision.getState().setAskHooks(r.ok && s.askHooks ? { "claude-code": !!s.askHooks.claude, codex: !!s.askHooks.codex } : null);
  } catch {
    useDecision.getState().setAskHooks(null);
  }
}

/** turns on the ask hook of one side, as the settings switch does; the error, or null */
export async function enableAskHook(faction: "claude-code" | "codex"): Promise<string | null> {
  try {
    const r = await fetch("/api/hooks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent: faction === "codex" ? "codex" : "claude", on: true, set: "ask" }) });
    if (!r.ok) return ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`;
    await refreshAskHooks();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** the page's token, from the server (it changes when the server restarts) */
export async function refreshToken() {
  const s = (await (await fetch("/api/status")).json().catch(() => ({}))) as { token?: string };
  useDecision.getState().setToken(s.token ?? null);
}
const send1 = (path: string, body: unknown) => {
  const token = useDecision.getState().token;
  return fetch(path, { method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-agent-universe-token": token } : {}) }, body: JSON.stringify(body) });
};
/** a refused token (the server restarted with a new one): fetch the new token and try once more */
const post = async (path: string, body: unknown) => {
  const r = await send1(path, body);
  if (r.status !== 403) return r;
  await refreshToken().catch(() => undefined);
  return send1(path, body);
};
/** send the page's choice to the waiting hook; false if it is no longer waiting */
export async function sendAnswer(id: string, a: { answers?: Record<string, string>; behavior?: "allow" | "deny" }): Promise<boolean> {
  const r = await post("/api/ask/answer", { id, ...a }).catch(() => null);
  return !!r?.ok;
}
/** "answer in the terminal": let the hook go at once */
export const releaseAsk = (id: string) => post("/api/ask/release", { id }).catch(() => null);

/**
 * The page's heartbeat (spec 2026-11-05 D26 B2): the server holds a hook only while a page is watching.
 * It beats from a worker, whose timer keeps time while the page is busy drawing (a slow first frame
 * delayed a main-thread timer by 15 s and the server let go). It beats while the page is visible or its
 * mini window is open.
 */
export function startPresence() {
  const code = `let on = true;
const beat = () => { if (on) fetch(${JSON.stringify(location.origin)} + "/api/presence", { method: "POST" }).catch(() => {}); };
onmessage = (e) => { on = !!e.data; beat(); };
beat();
setInterval(beat, 10000);`;
  let worker: Worker;
  try {
    worker = new Worker(URL.createObjectURL(new Blob([code], { type: "text/javascript" })));
  } catch {
    return; // no workers: no answering from the page, the terminal asks
  }
  const pip = () => !!(window as unknown as { documentPictureInPicture?: { window: Window | null } }).documentPictureInPicture?.window;
  const tell = () => worker.postMessage(document.visibilityState === "visible" || pip());
  document.addEventListener("visibilitychange", tell);
  window.addEventListener("agent-universe:mini", tell);
  tell();
}
