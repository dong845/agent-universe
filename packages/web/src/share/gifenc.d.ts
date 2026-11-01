// gifenc 1.0.3 ships no types; the three functions the recorder uses.
declare module "gifenc" {
  export function GIFEncoder(): { writeFrame(index: Uint8Array, w: number, h: number, o: { palette: number[][]; delay?: number }): void; finish(): void; bytes(): Uint8Array };
  export function quantize(rgba: Uint8ClampedArray | Uint8Array, maxColors: number, o?: { format?: string }): number[][];
  export function applyPalette(rgba: Uint8ClampedArray | Uint8Array, palette: number[][], format?: string): Uint8Array;
}
