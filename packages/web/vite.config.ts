import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Privacy (plan): the dev server binds to the loopback interface only.
export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5180, strictPort: true, fs: { allow: ["../.."] }, proxy: { "/api": "http://127.0.0.1:5182" } },
  preview: { host: "127.0.0.1", port: 5181, strictPort: true },
});
