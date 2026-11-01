// Opaque ids and code names for a shared world (spec 2026-11-01 B1), keyed by a secret that never
// leaves this machine (~/.agent-town/share-secret): the same town gets the same code name in every
// export, and nobody can test a guessed project name against it.
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ShareIds } from "../../schema/src/share.ts";

const STARS = ["Kepler", "Gliese", "Vega", "Lyra", "Orion", "Cygnus", "Draco", "Rigel", "Altair", "Sirius", "Deneb", "Carina", "Fomal", "Hydra", "Lupus", "Mira", "Nova", "Pavo", "Tucana", "Volans", "Ara", "Corvus", "Pyxis", "Antlia"];

const mac = (secret: string, what: string) => createHmac("sha256", secret).update(what).digest();

export function codeName(townKey: string, secret: string): string {
  const h = mac(secret, `name|${townKey}`);
  const star = STARS[h[0] % STARS.length];
  const n = 10 + (h.readUInt16BE(1) % 90);
  return `${star}-${n}${"abcdefgh"[h[3] % 8]}`;
}

export function makeShareIds(secret: string): ShareIds {
  return {
    id: (s) => mac(secret, `id|${s}`).toString("base64url").slice(0, 12),
    town: (key) => `t-${mac(secret, `town|${key}`).toString("hex").slice(0, 10)}`,
    name: (key) => codeName(key, secret),
  };
}

/** the owner's share secret, created once (mode 600) */
export function shareSecret(file: string): string {
  if (existsSync(file)) {
    const s = readFileSync(file, "utf8").trim();
    if (s.length >= 32) return s;
  }
  mkdirSync(dirname(file), { recursive: true });
  const s = randomBytes(32).toString("hex");
  writeFileSync(file, s + "\n", { mode: 0o600 });
  return s;
}
