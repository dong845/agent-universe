import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // the tests read the Chinese texts; English is tested by passing its own environment (spec 2026-11-05 D)
    env: { LANG: "zh_CN.UTF-8", LC_ALL: "", LC_MESSAGES: "" },
  },
});
