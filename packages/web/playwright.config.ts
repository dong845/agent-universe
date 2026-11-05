import { defineConfig } from "@playwright/test";

// Uses the Chrome already installed on this Mac (no browser download); WebGL via SwiftShader so
// it also runs headless without a GPU.
export default defineConfig({
  testDir: "e2e",
  testMatch: "*.spec.ts",
  timeout: 60_000,
  use: {
    channel: "chrome",
    viewport: { width: 1440, height: 900 },
    // the specs read the Chinese interface; English is checked by its own spec (spec 2026-11-05 D)
    locale: "zh-CN",
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
  },
  webServer: { command: "./node_modules/.bin/vite", url: "http://127.0.0.1:5180", reuseExistingServer: true },
});
