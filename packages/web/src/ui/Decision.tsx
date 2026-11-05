// The decision panel (spec 2026-11-05 D26 B3): what a session is waiting for you to decide — a question
// with its options, or an approval with what it would run — answered here and sent back to the waiting
// hook, so the session in the terminal goes on with your choice. Without a held hook it still shows the
// question from the record and says how to answer from the page next time.
import { useEffect, useMemo, useRef, useState } from "react";
import { townName } from "../i18n/data.ts";
import { t, useLang } from "../i18n/index.ts";
import { useStore } from "../store.ts";
import { answerOf, complete, releaseAsk, sendAnswer, useDecision, type Picks } from "./decision.ts";
import { toast } from "./NeedsYou.tsx";

export function DecisionPanel() {
  useLang();
  const open = useDecision((s) => s.open);
  const asks = useDecision((s) => s.asks);
  const attention = useStore((s) => s.attention);
  const w = useStore((s) => s.w25);
  const [picks, setPicks] = useState<Picks>({});
  const [busy, setBusy] = useState(false);
  const pending = useMemo(() => asks.filter((a) => a.session === open).at(-1), [asks, open]);
  const att = attention.find((a) => a.session === open);
  // answered elsewhere (the terminal, another page): say so and close
  const had = useRef(false);
  useEffect(() => {
    if (pending || att) had.current = true;
    else if (open && had.current) {
      toast(t("decide.answeredElsewhere"));
      useDecision.getState().show(null);
    }
  }, [pending, att, open]);
  useEffect(() => { setPicks({}); had.current = false; }, [open]);
  if (!open) return null;
  const questions = pending?.questions ?? att?.ask;
  const projectId = att?.projectId ?? pending?.cwd ?? "";
  const town = w?.towns.get(`${open.split("|")[0]}|${projectId}`);
  const where = town ? townName(town) : projectId.split("/").filter(Boolean).pop() ?? "";
  const close = () => useDecision.getState().show(null);
  const pick = (q: string, label: string, multi: boolean) => setPicks((p) => {
    const cur = p[q]?.labels ?? [];
    const labels = multi ? (cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label]) : [label];
    return { ...p, [q]: { labels, other: multi ? p[q]?.other : "" } };
  });
  const send = async (a: { answers?: Record<string, string>; behavior?: "allow" | "deny" }) => {
    if (!pending) return;
    setBusy(true);
    const ok = await sendAnswer(pending.id, a);
    setBusy(false);
    toast(ok ? t("decide.sent") : t("decide.gone"));
    if (ok) close();
  };
  return (
    <div className="g-decide" data-testid="decision" role="dialog" aria-label={t("decide.title")}>
      <button className="g-x" onClick={close} aria-label={t("common.close")}>×</button>
      <small>{where}{pending?.tool || att?.tool ? ` · ${pending?.tool ?? att?.tool}` : ""}</small>
      <b>{questions ? t("decide.question") : t("decide.approval")}</b>
      {questions ? questions.map((q) => (
        <fieldset key={q.question}>
          <legend>{q.header ? <em>{q.header}</em> : null}{q.question}</legend>
          {q.options.map((o) => (
            <label key={o.label} className={picks[q.question]?.labels.includes(o.label) ? "on" : ""}>
              <input type={q.multiSelect ? "checkbox" : "radio"} name={q.question} checked={!!picks[q.question]?.labels.includes(o.label)} disabled={!pending} onChange={() => pick(q.question, o.label, q.multiSelect)} data-testid="decision-option" />
              <span><b>{o.label}</b>{o.description ? <small>{o.description}</small> : null}</span>
            </label>
          ))}
          {pending ? (
            <input className="g-decide-other" placeholder={t("decide.other")} value={picks[q.question]?.other ?? ""} data-testid="decision-other"
              onChange={(e) => { const other = e.target.value; setPicks((p) => ({ ...p, [q.question]: { labels: q.multiSelect ? p[q.question]?.labels ?? [] : [], other } })); }} />
          ) : null}
        </fieldset>
      )) : pending?.summary ? <pre className="g-decide-run">{pending.summary}</pre> : null}
      {pending ? (
        <div className="g-decide-actions">
          <button onClick={() => { void releaseAsk(pending.id); close(); }} data-testid="decision-terminal">{t("decide.inTerminal")}</button>
          {questions
            ? <button className="primary" disabled={busy || !complete(questions, picks)} onClick={() => void send({ answers: answerOf(questions, picks) })} data-testid="decision-send">{t("decide.send")}</button>
            : <>
                <button disabled={busy} onClick={() => void send({ behavior: "deny" })} data-testid="decision-deny">{t("decide.deny")}</button>
                <button className="primary" disabled={busy} onClick={() => void send({ behavior: "allow" })} data-testid="decision-allow">{t("decide.allow")}</button>
              </>}
        </div>
      ) : <p className="muted" data-testid="decision-howto">{t("decide.howTo")}</p>}
    </div>
  );
}
