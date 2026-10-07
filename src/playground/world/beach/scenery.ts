/**
 * Where the beach's set dressing stands. All of it outside the walk limit.
 *
 * Positions are derived from the coast definition (a rock "at the waterline"
 * is placed by asking where the waterline is), seeded, and identical for
 * every visitor. Nothing here has a collider: it is all beyond WORLD_RADIUS,
 * which is the one wall people actually meet.
 */
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import { FLAT_RADIUS, shoreDistance, shoreZ, terrainHeight } from "./coast";
import { disposeGltf, LoadAborted, type BeachAssets } from "./assets";
import { seeded, type PalmPlacement } from "./vegetation";

/** Palms beyond the plaza edge, framing the view both ways along the coast. */
export const OUTER_PALMS: readonly PalmPlacement[] = [
  { x: -27, z: 7, scale: 1.6 },
  { x: -31.5, z: -5, scale: 1.3 },
  { x: -25, z: -14, scale: 1.2 },
  { x: 26.5, z: -6, scale: 1.5 },
  { x: 31, z: 9, scale: 1.7 },
  { x: 24, z: -16.5, scale: 1.1 },
  { x: -21, z: 29, scale: 1.8 },
  { x: 19, z: 31, scale: 1.6 },
  { x: -3, z: 36, scale: 1.4 },
  { x: -39, z: 18, scale: 1.5 },
  { x: 41, z: 21, scale: 1.4 },
];

type RockKind = "block" | "slab" | "round";

interface RockPlacement {
  kind: RockKind;
  x: number;
  /** Metres inland from the waterline at this x (negative: standing in water). */
  inland: number;
  size: number;
  yaw: number;
  sink: number;
}

/** Two headland groups at the waterline, a few half-buried in the dunes. */
const ROCKS: readonly RockPlacement[] = [
  { kind: "block", x: -35, inland: 1.5, size: 3.2, yaw: 0.4, sink: 0.5 },
  { kind: "round", x: -39.5, inland: 3.5, size: 2.1, yaw: 1.9, sink: 0.4 },
  { kind: "slab", x: -31, inland: -1.2, size: 2.6, yaw: 2.6, sink: 0.35 },
  { kind: "round", x: -33, inland: -3.6, size: 1.4, yaw: 0.2, sink: 0.25 },
  { kind: "block", x: 31, inland: 0.8, size: 2.8, yaw: 3.6, sink: 0.45 },
  { kind: "slab", x: 35.5, inland: 3, size: 2.4, yaw: 0.9, sink: 0.4 },
  { kind: "round", x: 27.5, inland: -2.4, size: 1.7, yaw: 4.4, sink: 0.3 },
  { kind: "round", x: 47, inland: 2, size: 2.4, yaw: 1.2, sink: 0.4 },
  { kind: "slab", x: -47, inland: 1, size: 3, yaw: 5.1, sink: 0.4 },
];

const DUNE_ROCKS: readonly { kind: RockKind; x: number; z: number; size: number; yaw: number }[] = [
  { kind: "round", x: -29, z: 17, size: 1.8, yaw: 0.7 },
  { kind: "slab", x: 30, z: 25, size: 2.2, yaw: 2.2 },
  { kind: "block", x: 9, z: 37, size: 2.0, yaw: 4.0 },
];

/** Dune grass tufts: [x, z, groundY], seeded, only on dry sand away from the plaza. */
export function grassPlacements(count: number): (readonly [number, number, number])[] {
  const random = seeded(77);
  const out: (readonly [number, number, number])[] = [];
  let guard = 0;
  while (out.length < count && guard < count * 20) {
    guard += 1;
    const angle = random() * Math.PI * 2;
    const radius = FLAT_RADIUS + 2 + Math.pow(random(), 1.5) * 50;
    const x = Math.sin(angle) * radius;
    const z = -Math.cos(angle) * radius;
    if (shoreDistance(x, z) < 9) continue;
    out.push([x, z, terrainHeight(x, z)] as const);
  }
  return out;
}

const MODEL: Record<RockKind, string> = {
  block: "rock-block",
  slab: "rock-slab",
  round: "rock-round",
};

function meshOf(gltf: GLTF): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  gltf.scene.traverse((object) => {
    if (!found && (object as THREE.Mesh).isMesh) found = object as THREE.Mesh;
  });
  return found;
}

/**
 * Load the rock models and place them under `parent`. Each rock is a LOD:
 * the reduced scan within 45m, a coarser one beyond, both sharing one
 * material whose maps arrive as separate JPEGs. A rock whose files fail to
 * load is simply absent.
 */
export async function placeRocks(
  parent: THREE.Object3D,
  assets: BeachAssets,
  signal: AbortSignal,
  track: (resource: { dispose(): void }) => void,
): Promise<void> {
  const kinds: RockKind[] = ["block", "slab", "round"];
  const loaded = new Map<RockKind, [THREE.BufferGeometry, THREE.BufferGeometry, THREE.Material]>();
  await Promise.all(
    kinds.map(async (kind) => {
      try {
        const name = MODEL[kind];
        const settled = await Promise.allSettled([
          assets.model(`${name}-lod0.glb`),
          assets.model(`${name}-lod1.glb`),
          // glTF UVs: no vertical flip.
          assets.texture(`${name}_color_512.jpg`, THREE.SRGBColorSpace, { flipY: false }),
          assets.texture(`${name}_normal_512.jpg`, THREE.NoColorSpace, { flipY: false }),
          assets.texture(`${name}_orm_512.jpg`, THREE.NoColorSpace, { flipY: false }),
        ] as const);
        const failed = settled.find((result) => result.status === "rejected");
        if (failed || signal.aborted) {
          // All or nothing per rock: release whatever did arrive.
          for (const result of settled) {
            if (result.status !== "fulfilled") continue;
            if (result.value instanceof THREE.Texture) result.value.dispose();
            else disposeGltf(result.value);
          }
          throw failed ? (failed as PromiseRejectedResult).reason : new LoadAborted();
        }
        const [near, far, color, normal, orm] = settled.map(
          (result) => (result as PromiseFulfilledResult<unknown>).value,
        ) as [GLTF, GLTF, THREE.Texture, THREE.Texture, THREE.Texture];
        const geometries = [meshOf(near), meshOf(far)].map((mesh) => {
          if (!mesh) return null;
          // Loader-made default materials are not used; only the geometry is.
          (mesh.material as THREE.Material).dispose();
          return mesh.geometry;
        });
        const material = new THREE.MeshStandardMaterial({
          map: color,
          normalMap: normal,
          // As GLTFLoader does for maps without tangents.
          normalScale: new THREE.Vector2(1, -1),
          roughnessMap: orm,
          aoMap: orm,
          aoMapIntensity: 0.8,
          roughness: 1,
          metalness: 0,
        });
        track(material);
        for (const texture of [color, normal, orm]) track(texture);
        if (!geometries[0] || !geometries[1]) return;
        // Normalise: unit size, resting on its lowest point, centred — the
        // same transform for both levels, measured on the detailed one.
        geometries[0].computeBoundingBox();
        const box = geometries[0].boundingBox as THREE.Box3;
        const size = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());
        const largest = Math.max(size.x, size.z);
        for (const geometry of geometries as THREE.BufferGeometry[]) {
          geometry.translate(-centre.x, -box.min.y, -centre.z);
          geometry.scale(1 / largest, 1 / largest, 1 / largest);
          geometry.computeBoundingSphere();
          track(geometry);
        }
        loaded.set(kind, [geometries[0], geometries[1], material]);
      } catch (error) {
        if ((error as Error).message !== "load_aborted") {
          console.warn(`[plaza] rock model unavailable: ${kind}`);
        }
      }
    }),
  );
  if (signal.aborted) return;

  const place = (kind: RockKind, x: number, z: number, size: number, yaw: number, sink: number) => {
    const rock = loaded.get(kind);
    if (!rock) return;
    const [near, far, material] = rock;
    const lod = new THREE.LOD();
    for (const [index, geometry] of [near, far].entries()) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = index === 0;
      mesh.receiveShadow = true;
      lod.addLevel(mesh, index === 0 ? 0 : 45);
    }
    lod.position.set(x, terrainHeight(x, z) - sink * size * 0.5, z);
    lod.rotation.y = yaw;
    lod.scale.setScalar(size);
    parent.add(lod);
  };

  for (const rock of ROCKS) {
    // Walk inland from the waterline along +z: close enough for these slopes.
    const z = shoreZ(rock.x) + rock.inland;
    place(rock.kind, rock.x, z, rock.size, rock.yaw, rock.sink);
  }
  for (const rock of DUNE_ROCKS) {
    place(rock.kind, rock.x, rock.z, rock.size, rock.yaw, 0.35);
  }
}
