/**
 * Loading the beach's files without letting a slow one land in the wrong place.
 *
 * Nothing the World needs to be usable is fetched: sand and sea draw from
 * procedural placeholders the moment the World mounts, and chat never waits
 * on a texture. Files only refine what is already there. Each load is tied to
 * the World's abort signal; a decode that completes after the World was
 * unmounted is disposed on arrival instead of being attached to anything.
 *
 * Images are always plain same-origin image requests. (A GLB with embedded
 * images would make GLTFLoader fetch `blob:` URLs, which the static-web CSP
 * refuses; the rock models ship their maps as separate JPEGs instead.)
 *
 * Failures degrade per file. A 404 that the SPA fallback answers with
 * `index.html` and a 200 fails image decode or the glTF magic check, so a
 * success here means real bytes of the right kind, not just a status code.
 */
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

const BASE = `${import.meta.env.BASE_URL}assets/beach/`;
const RETRIES = 2;

export class LoadAborted extends Error {
  constructor() {
    super("load_aborted");
  }
}

async function withRetry<T>(signal: AbortSignal, attempt: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let tries = 0; tries <= RETRIES; tries += 1) {
    if (signal.aborted) throw new LoadAborted();
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 600 * (tries + 1)));
    }
  }
  throw lastError;
}

export interface BeachAssets {
  /** `flipY: false` for maps authored against glTF UVs (origin top-left). */
  texture(
    name: string,
    colorSpace: THREE.ColorSpace,
    options?: { flipY?: boolean },
  ): Promise<THREE.Texture>;
  model(name: string): Promise<GLTF>;
}

export function createBeachAssets(
  signal: AbortSignal,
  anisotropy: number,
): BeachAssets {
  const textures = new THREE.TextureLoader();
  const models = new GLTFLoader();

  return {
    async texture(name, colorSpace, options = {}) {
      const texture = await withRetry(signal, () =>
        textures.loadAsync(`${BASE}textures/${name}`),
      );
      if (signal.aborted) {
        texture.dispose();
        throw new LoadAborted();
      }
      texture.colorSpace = colorSpace;
      texture.flipY = options.flipY ?? true;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = anisotropy;
      texture.needsUpdate = true;
      return texture;
    },

    async model(name) {
      const gltf = await withRetry(signal, () =>
        models.loadAsync(`${BASE}models/${name}`),
      );
      if (signal.aborted) {
        disposeGltf(gltf);
        throw new LoadAborted();
      }
      return gltf;
    },
  };
}

/** Release everything a parsed glTF holds, for one that arrived too late. */
export function disposeGltf(gltf: GLTF): void {
  gltf.scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}

/** A 1×1 texture to stand in until the real one arrives. */
export function placeholderTexture(
  rgba: [number, number, number, number],
  colorSpace: THREE.ColorSpace,
): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array(rgba), 1, 1, THREE.RGBAFormat);
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}
