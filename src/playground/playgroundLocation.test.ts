import { afterEach, describe, expect, it, vi } from "vitest";

import { pwaUrl } from "./playgroundLocation";

describe("playgroundLocation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // The reverse direction — where the PWA links TO Plaza — is tested in the
  // PWA (`playgroundCanonicalUrl`). Plaza itself never reads its own address
  // from configuration.
  // Playground runs on its own origin, so a relative `/a/<slug>` would resolve
  // against the Playground host, which serves no App pages.
  it("builds card links absolute against the configured PWA origin", () => {
    vi.stubEnv("VITE_PWA_ORIGIN", "https://stg-app.ato.run");
    expect(pwaUrl("/a/excalidraw")).toBe("https://stg-app.ato.run/a/excalidraw");
  });

  it("refuses a non-absolute path", () => {
    vi.stubEnv("VITE_PWA_ORIGIN", "https://stg-app.ato.run");
    expect(pwaUrl("a/excalidraw")).toBeNull();
  });
});
