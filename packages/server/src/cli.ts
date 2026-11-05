// Argument helpers for scripts/serve.ts, kept here so they are testable.
import { fileURLToPath } from "node:url";
import { langOf, say } from "./text.ts";

export const DEFAULT_PORT = 5182;

export function parsePort(s: string | undefined): number {
  if (s === undefined) return DEFAULT_PORT;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(say(langOf(), "port.bad", { v: s }));
  return n;
}

/** the web build next to the repo's scripts/ folder; a real path, so spaces and CJK names work */
export function staticDirFrom(scriptUrl: URL): string {
  return fileURLToPath(new URL("../packages/web/dist", scriptUrl));
}
