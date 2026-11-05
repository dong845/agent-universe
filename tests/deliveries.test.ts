// Cars are deliveries (spec 2026-11-05 D26 A2): a request that just finished with a product.
import { describe, expect, it } from "vitest";
import { deliveriesAt, DRIVE_MS, PARK_MS } from "../packages/web/src/city/deliveries.ts";

const r = (requestId: string, endTs: number, cls: "produced" | "chat" | "investigation" = "produced") => ({ requestId, endTs, class: cls });

describe("deliveriesAt", () => {
  it("a finished product drives out, parks, then is gone", () => {
    const reqs = [r("a", 1000)];
    expect(deliveriesAt(reqs, 999)).toEqual([]);
    expect(deliveriesAt(reqs, 1000)[0]).toMatchObject({ requestId: "a", k: 0, fade: 1 });
    expect(deliveriesAt(reqs, 1000 + DRIVE_MS / 2)[0].k).toBeCloseTo(0.5);
    expect(deliveriesAt(reqs, 1000 + DRIVE_MS + PARK_MS / 2)[0]).toMatchObject({ k: 1 });
    expect(deliveriesAt(reqs, 1000 + DRIVE_MS + PARK_MS / 2)[0].fade).toBeCloseTo(0.5);
    expect(deliveriesAt(reqs, 1000 + DRIVE_MS + PARK_MS + 1)).toEqual([]);
  });
  it("no product, no car", () => {
    expect(deliveriesAt([r("q", 1000, "chat"), r("i", 1000, "investigation")], 1500)).toEqual([]);
  });
  it("several at once, oldest first", () => {
    expect(deliveriesAt([r("b", 2000), r("a", 1000)], 2500).map((d) => d.requestId)).toEqual(["a", "b"]);
  });
});
