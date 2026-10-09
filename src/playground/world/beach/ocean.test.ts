import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { rippleTexture } from "./ocean";

describe("ripple normal/foam map", () => {
  // Captured from the direct trigonometric implementation before optimization.
  // Covers the fountain, ocean and a non-power-of-two/non-production size.
  it.each([
    [17, "b792c634218655052511d16b13016dd817fb33fd656b2e31fa3ba29d02a6fa33"],
    [96, "70cc46cbeaacf26a1b8fa27ef3ffe64e930c8491013b27f503187041783fe9fb"],
    [256, "a69254f5a27dc01560f5767d340976f3a0f1dc1e46a690bbd0a9e577daff63ee"],
  ] as const)("preserves every channel of the original %i-pixel map", async (size, expected) => {
    const texture = rippleTexture(size);
    const bytes = new Uint8Array(texture.image.data as Uint8Array);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    expect(hex).toBe(expected);
    expect(texture.image.width).toBe(size);
    expect(texture.image.height).toBe(size);
    texture.dispose();
  });

  it("keeps independent texture ownership and the existing sampling configuration", () => {
    const ocean = rippleTexture();
    const other = rippleTexture();
    expect(ocean.image.data).not.toBe(other.image.data);
    (ocean.image.data as Uint8Array).fill(0);
    expect((other.image.data as Uint8Array).some((byte) => byte !== 0)).toBe(true);
    expect(other.wrapS).toBe(THREE.RepeatWrapping);
    expect(other.wrapT).toBe(THREE.RepeatWrapping);
    expect(other.magFilter).toBe(THREE.LinearFilter);
    expect(other.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(other.generateMipmaps).toBe(true);
    expect(other.anisotropy).toBe(4);
    expect(other.colorSpace).toBe(THREE.NoColorSpace);
    ocean.dispose();
    other.dispose();
  });
});
