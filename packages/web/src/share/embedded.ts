// A shared page (spec 2026-11-01 D) carries its world and models inside itself: <script
// type="application/json"> blocks written by the server's exporter. Viewer mode = such a block exists.
import type { WorldPayload } from "../../../schema/src/payload.ts";
import { t } from "../i18n/index.ts";

const block = (id: string) => (typeof document === "undefined" ? null : document.getElementById(id));

export function isViewer(): boolean {
  return !!block("agent-town-share");
}

let world: WorldPayload | null | undefined;
export function embeddedWorld(): WorldPayload | null {
  if (world === undefined) world = isViewer() ? (JSON.parse(block("agent-town-share")!.textContent ?? "null") as WorldPayload) : null;
  return world;
}

let models: Record<string, string> | null = null;
/** a model's URL: the server's file, or in a shared page a blob made from the embedded copy */
export function modelUrl(name: string): string {
  if (!isViewer()) return `/models/${name}.glb`;
  models ??= JSON.parse(block("agent-town-models")?.textContent ?? "{}") as Record<string, string>;
  const b64 = models[name];
  if (!b64) throw new Error(t("share.noModel", { name }));
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "model/gltf-binary" }));
  models[name] = "";
  urls.set(name, url);
  return url;
}
const urls = new Map<string, string>();
/** the same URL for a model asked for twice */
export function modelUrlOnce(name: string): string {
  return urls.get(name) ?? modelUrl(name);
}
