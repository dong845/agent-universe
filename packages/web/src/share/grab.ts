// One finished frame of the 3D view, as a canvas (spec 2026-11-05 C3: the poster's background). Drawn
// right after the frame is rendered (priority 2, as the recorder does), before the browser clears it.
import { useFrame, useThree } from "@react-three/fiber";

let pending: ((c: HTMLCanvasElement) => void)[] = [];

export function grabFrame(): Promise<HTMLCanvasElement> {
  return new Promise((resolve) => pending.push(resolve));
}

export function FrameGrab() {
  const { gl } = useThree();
  useFrame(() => {
    if (!pending.length) return;
    const src = gl.domElement;
    const c = document.createElement("canvas");
    c.width = src.width;
    c.height = src.height;
    c.getContext("2d")!.drawImage(src, 0, 0);
    const p = pending;
    pending = [];
    for (const f of p) f(c);
  }, 2);
  return null;
}
