// Which sprite is under the pointer (spec v3 8.4): the ray hits a quad, but only its opaque pixels count.

/** is the texel at (u, v) opaque? `alpha` is RGBA bytes, top row first; v counts from the bottom (three.js) */
export function opaqueAt(rgba: Uint8ClampedArray, w: number, h: number, uv: { x: number; y: number }, threshold = 100): boolean {
  if (uv.x < 0 || uv.x >= 1 || uv.y <= 0 || uv.y > 1) return false;
  const col = Math.floor(uv.x * w);
  const row = Math.floor((1 - uv.y) * h);
  return rgba[(row * w + col) * 4 + 3] > threshold;
}

const cache = new WeakMap<object, { data: Uint8ClampedArray; w: number; h: number }>();
/** the texture image's pixels, read once */
export function pixelsOf(image: CanvasImageSource & { width: number; height: number }): { data: Uint8ClampedArray; w: number; h: number } {
  let p = cache.get(image);
  if (!p) {
    const cv = document.createElement("canvas");
    cv.width = image.width;
    cv.height = image.height;
    const g = cv.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(image, 0, 0);
    p = { data: g.getImageData(0, 0, cv.width, cv.height).data, w: cv.width, h: cv.height };
    cache.set(image, p);
  }
  return p;
}
