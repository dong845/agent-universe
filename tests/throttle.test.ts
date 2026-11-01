// A newer world costs the page a rebuild (~0.2 s on the real record): apply at most one per interval,
// always the latest, never while something says to hold (a recording).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { latestEvery } from "../packages/web/src/throttle.ts";

describe("latestEvery", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("applies the latest value at most once per interval", () => {
    const got: number[] = [];
    const push = latestEvery<number>((v) => got.push(v), 30_000, () => false);
    push(1);
    vi.advanceTimersByTime(29_000);
    push(2);
    push(3);
    expect(got).toEqual([]);
    vi.advanceTimersByTime(1_000);
    expect(got).toEqual([3]);
    push(4);
    vi.advanceTimersByTime(29_999);
    expect(got).toEqual([3]);
    vi.advanceTimersByTime(1);
    expect(got).toEqual([3, 4]);
  });
  it("holds while told to, then applies", () => {
    let hold = true;
    const got: number[] = [];
    const push = latestEvery<number>((v) => got.push(v), 1000, () => hold);
    push(1);
    vi.advanceTimersByTime(5000);
    expect(got).toEqual([]);
    hold = false;
    vi.advanceTimersByTime(1000);
    expect(got).toEqual([1]);
  });
});
