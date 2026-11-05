// Answering from the page (spec 2026-11-05 D26 B2/B4/B5). An agent's PermissionRequest hook posts its
// input here and waits for the reply. The server holds it only while a page of Agent Universe is open and
// visible (the page's heartbeat), at most holdMs; otherwise it replies at once with nothing, and the agent
// asks in the terminal as usual (the terminal also shows the question while the hook waits; whichever
// answers first wins). The page answers: a question gets `allow` with the answers filled into the tool's
// input; an approval gets `allow` or `deny`. Every other path — timeout, "answer in the terminal", the log
// showing the call answered, the hook's connection closing — replies with nothing.
import type { AskQuestion } from "../../schema/src/event.ts";
import { askQuestionsOf } from "../../schema/src/ask.ts";

export type AskSrc = "claude" | "codex";
export interface PendingAsk {
  id: string;
  src: AskSrc;
  /** "<faction>|<sessionId>", as 需要你 keys its entries */
  session: string;
  sessionId: string;
  tool: string;
  kind: "question" | "approval";
  questions?: AskQuestion[];
  /** what an approval would let run (a command, a file), clipped */
  summary?: string;
  cwd?: string;
  since: number;
}
export interface AskAnswer { answers?: Record<string, string>; behavior?: "allow" | "deny" }

interface Held { p: PendingAsk; input: Record<string, unknown>; respond: (body: string) => void; cancel: () => void }

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
function summaryOf(input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined;
  for (const k of ["command", "cmd", "file_path", "path", "url", "pattern"]) {
    const v = input[k];
    if (typeof v === "string") return clip(v, 300);
    if (Array.isArray(v)) return clip(v.join(" "), 300);
  }
  const j = JSON.stringify(input);
  return j && j !== "{}" ? clip(j, 300) : undefined;
}

export function createAsks(o: { now?: () => number; setTimer?: (ms: number, f: () => void) => () => void; holdMs?: number; watchMs?: number; onChange?: () => void } = {}) {
  const now = o.now ?? Date.now;
  const setTimer = o.setTimer ?? ((ms, f) => { const h = setTimeout(f, ms); return () => clearTimeout(h); });
  const holdMs = o.holdMs ?? 120_000;
  const watchMs = o.watchMs ?? 25_000;
  const held = new Map<string, Held>();
  let lastBeat = -Infinity;
  let seq = 0;
  const changed = () => o.onChange?.();
  const finish = (id: string, body: string) => {
    const h = held.get(id);
    if (!h) return false;
    held.delete(id);
    h.cancel();
    h.respond(body);
    changed();
    return true;
  };
  const decision = (src: AskSrc, d: Record<string, unknown>) => JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision: d } });

  return {
    heartbeat() { lastBeat = now(); },
    watching: () => now() - lastBeat <= watchMs,
    /** a hook arrived: hold it for the page, or let the terminal ask */
    hold(src: AskSrc, raw: unknown, respond: (body: string) => void): string | null {
      const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
      const sessionId = typeof input.session_id === "string" ? input.session_id : "";
      if (!(now() - lastBeat <= watchMs) || !sessionId) {
        respond("");
        return null;
      }
      const tool = typeof input.tool_name === "string" ? input.tool_name : "";
      const questions = src === "claude" && tool === "AskUserQuestion" ? askQuestionsOf(input.tool_input) : undefined;
      const id = `ask-${++seq}-${now().toString(36)}`;
      const p: PendingAsk = {
        id, src, session: `${src === "claude" ? "claude-code" : "codex"}|${sessionId}`, sessionId, tool,
        kind: questions ? "question" : "approval",
        ...(questions ? { questions } : { summary: summaryOf(input.tool_input) }),
        ...(typeof input.cwd === "string" ? { cwd: input.cwd } : {}),
        since: now(),
      };
      const cancel = setTimer(holdMs, () => finish(id, ""));
      held.set(id, { p, input: (input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {}) as Record<string, unknown>, respond, cancel });
      changed();
      return id;
    },
    /** the page's choice; false when it does not fit what is waiting */
    answer(id: string, a: AskAnswer): boolean {
      const h = held.get(id);
      if (!h) return false;
      if (h.p.kind === "question") {
        if (!a.answers || typeof a.answers !== "object") return false;
        return finish(id, decision(h.p.src, { behavior: "allow", updatedInput: { ...h.input, answers: a.answers } }));
      }
      if (a.behavior !== "allow" && a.behavior !== "deny") return false;
      return finish(id, decision(h.p.src, h.p.src === "claude" && a.behavior === "deny" ? { behavior: "deny", message: "Declined from Agent Universe" } : { behavior: a.behavior }));
    },
    /** "answer in the terminal": let go now */
    release: (id: string) => finish(id, ""),
    /** the hook's own connection closed (the agent moved on or was stopped) */
    drop(id: string) {
      const h = held.get(id);
      if (!h) return;
      held.delete(id);
      h.cancel();
      changed();
    },
    /** let go of every held hook the record shows is no longer waiting */
    settle(over: (p: PendingAsk) => boolean) {
      for (const [id, h] of [...held]) if (over(h.p)) finish(id, "");
    },
    /** no page has looked for watchMs: let go of everything held (the terminal still asks) */
    expire() {
      if (now() - lastBeat > watchMs) for (const id of [...held.keys()]) finish(id, "");
    },
    pending: (): PendingAsk[] => [...held.values()].map((h) => h.p),
  };
}
export type Asks = ReturnType<typeof createAsks>;
