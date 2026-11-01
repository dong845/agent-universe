import { describe, expect, it } from "vitest";
import { fileName, pickMime } from "../packages/web/src/share/recordFormat.ts";

describe("recording format", () => {
  it("prefers MP4 (H.264) where the browser can record it", () => {
    expect(pickMime((m) => m.startsWith("video/mp4"))).toEqual({ mime: "video/mp4;codecs=avc1", ext: "mp4" });
  });
  it("falls back to WebM", () => {
    expect(pickMime((m) => m.startsWith("video/webm"))).toEqual({ mime: "video/webm;codecs=vp9", ext: "webm" });
    expect(pickMime((m) => m === "video/webm")).toEqual({ mime: "video/webm", ext: "webm" });
  });
  it("says so when the browser records nothing", () => {
    expect(() => pickMime(() => false)).toThrow(/不能录/);
  });
  it("names the file after the town's display name and the day", () => {
    expect(fileName("Kepler-07c", new Date(2026, 10, 1, 21, 5), "mp4")).toBe("agent-town-Kepler-07c-2026-11-01.mp4");
    expect(fileName("a/b: c", new Date(2026, 0, 2), "gif")).toBe("agent-town-a-b-c-2026-01-02.gif");
  });
});
