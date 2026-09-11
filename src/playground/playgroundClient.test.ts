import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PLAYGROUND_API_PREFIX,
  playgroundClient,
  playgroundSocketUrl,
} from "./playgroundClient";
import { pwaUrl } from "./playgroundLocation";

describe("playgroundSocketUrl", () => {
  // The socket is same-origin by construction: the document was served by the
  // canonical host, so that host is by definition the right one to talk to.
  // There is no configured value that could point it elsewhere.
  it("derives wss from the serving host", () => {
    expect(
      playgroundSocketUrl("market", {
        protocol: "https:",
        host: "playground.stg-app.ato.run",
      }),
    ).toBe(
      `wss://playground.stg-app.ato.run${PLAYGROUND_API_PREFIX}/connect?world=market`,
    );
  });

  it("uses ws for a plain-http dev host", () => {
    expect(
      playgroundSocketUrl("central-plaza", {
        protocol: "http:",
        host: "127.0.0.1:5173",
      }),
    ).toBe(
      `ws://127.0.0.1:5173${PLAYGROUND_API_PREFIX}/connect?world=central-plaza`,
    );
  });
});

describe("Playground durable World lane", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("scopes bootstrap, catch-up, and writes to the selected World", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ events: [], cursor: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetch);

    await playgroundClient.bootstrap("market");
    await playgroundClient.events(17, "market");
    await playgroundClient.postText("hello", "operation_world_01", "market");

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `${PLAYGROUND_API_PREFIX}/bootstrap?world=market`,
      `${PLAYGROUND_API_PREFIX}/events?after=17&world=market`,
      `${PLAYGROUND_API_PREFIX}/posts?world=market`,
    ]);
  });
});

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
