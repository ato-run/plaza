import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

/**
 * Plaza standalone build.
 *
 * Plaza is served from its own origin (the canonical app host serves this
 * bundle at `/`, see ato-api's `app_proxy_playground.ts`), so `base` stays
 * `/` and `public/` is copied as-is. There is deliberately no service worker,
 * no PWA shell, and no second entry: one screen, one bundle.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  server: {
    port: 5174,
    host: true,
  },
  test: {
    environment: "node",
  },
});
