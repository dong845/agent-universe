// The questions of a question-with-options call (Claude's AskUserQuestion), normalised from its input —
// shared by the log adapter and the answer server (spec 2026-11-05 D26 B1).
import type { AskQuestion } from "./event.ts";

export function askQuestionsOf(input: unknown): AskQuestion[] | undefined {
  const qs = (input as { questions?: unknown } | undefined)?.questions;
  if (!Array.isArray(qs)) return undefined;
  const out = qs
    .filter((q: any) => q && typeof q.question === "string" && Array.isArray(q.options))
    .map((q: any): AskQuestion => ({
      question: q.question,
      ...(typeof q.header === "string" ? { header: q.header } : {}),
      multiSelect: q.multiSelect === true,
      options: q.options.filter((o: any) => o && typeof o.label === "string").map((o: any) => ({ label: o.label, ...(typeof o.description === "string" ? { description: o.description } : {}) })),
    }));
  return out.length ? out : undefined;
}
