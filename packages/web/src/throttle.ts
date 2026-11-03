// Rate-limits a stream of values to the latest one per interval (spec 2026-11-01 A1: a newer world
// rebuilds the page's world, ~0.2 s on the real record — a stutter if it came every few seconds).

/** returns push(v): `apply` gets the latest value no sooner than `ms` after the last apply (counting from `start`), and never while `hold()` */
export function latestEvery<T>(apply: (v: T) => void, ms: number, hold: () => boolean, start = Date.now()): (v: T) => void {
  let last = start;
  let pending: { v: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = () => {
    timer = null;
    if (!pending) return;
    if (hold()) {
      timer = setTimeout(run, Math.min(ms, 1000));
      return;
    }
    const { v } = pending;
    pending = null;
    last = Date.now();
    apply(v);
  };
  return (v) => {
    pending = { v };
    if (!timer) timer = setTimeout(run, Math.max(0, last + ms - Date.now()));
  };
}

/**
 * Runs `work` for one value at a time; values that arrive meanwhile wait, and only the newest of them
 * runs next (review 2026-11-04: in a hidden tab frames stop, and every world that arrived used to park
 * its own preparation, all of which ran back to back when the tab came back).
 */
export function latestApplier<T>(work: (v: T, frame: () => Promise<unknown>) => Promise<void>, frame: () => Promise<unknown>): (v: T) => void {
  let running = false;
  let next: { v: T } | null = null;
  const run = async (v: T) => {
    running = true;
    try {
      await work(v, frame);
    } finally {
      running = false;
      if (next) {
        const n = next.v;
        next = null;
        void run(n);
      }
    }
  };
  return (v) => {
    if (running) next = { v };
    else void run(v);
  };
}
