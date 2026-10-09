/**
 * The plaza's furniture: the fountain, benches, planters and lamp posts.
 *
 * Modelled here rather than loaded, because no openly licensed scan of a
 * seaside fountain or a slatted bench exists; what makes them read as real is
 * not the polygon count but the details a primitive lacks — bevelled edges
 * that catch light, a profile with lips and mouldings, scanned PBR surfaces at
 * true physical scale (coral limestone, stone masonry, teak grain), moving
 * water — so that is what is built. Things that ARE better scanned (the brass
 * lantern, the planter plants) are scanned and loaded.
 *
 * Every piece keeps the footprint and collider it had: `centralGeometry` is
 * shared with the AI Controller and the server and does not change.
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import { disposeGltf, LoadAborted, type BeachAssets } from "./assets";
import { rippleTexture } from "./ocean";
import { seeded } from "./vegetation";
import type { WorldBuilder } from "../primitives";

/** Fountain dimensions, metres. The rim top is the climbable step. */
export const FOUNTAIN = {
  rimTop: 0.6,
  /** Inside edge of the rim: the pool. */
  poolRadius: 2.82,
  /**
   * Just under the rim: the whole fountain top is one step (see the
   * climbable collider), so the water sits where standing in it reads as
   * ankle-deep rather than as floating above it.
   */
  waterY: 0.565,
  poolFloor: 0.42,
  columnRadius: 1.15,
} as const;

// ---- surfaces ---------------------------------------------------------------

interface Surface {
  material: THREE.MeshStandardMaterial;
  /** Physical size of one texture tile, metres. */
  tile: number;
  /**
   * Multiplier once the scan arrives (linear RGB). The flat colour before
   * that is the scan's average; afterwards the scan carries the colour, so
   * this is ~white, nudged only to warm or lighten a material.
   */
  dressed: THREE.Color;
}

function surface(
  color: string,
  tile: number,
  roughness = 0.9,
  dressed = new THREE.Color(1, 1, 1),
): Surface {
  return {
    material: new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 }),
    tile,
    dressed,
  };
}

/** Load a Poly Haven diff/nor/arm set onto a surface once it arrives. */
async function dress(
  target: Surface,
  slug: string,
  assets: BeachAssets,
  signal: AbortSignal,
): Promise<void> {
  const settled = await Promise.allSettled([
    assets.texture(`${slug}_diff_1k.jpg`, THREE.SRGBColorSpace),
    assets.texture(`${slug}_nor_1k.jpg`, THREE.NoColorSpace),
    assets.texture(`${slug}_arm_1k.jpg`, THREE.NoColorSpace),
  ]);
  const [map, normal, arm] = settled.map((result) =>
    result.status === "fulfilled" ? result.value : null,
  );
  if (signal.aborted) {
    for (const texture of [map, normal, arm]) texture?.dispose();
    return;
  }
  const material = target.material;
  if (map) {
    material.map = map;
    material.color.copy(target.dressed);
  }
  if (normal) {
    material.normalMap = normal;
    material.normalScale.set(1, 1);
  }
  if (arm) {
    material.roughnessMap = arm;
    material.aoMap = arm;
    material.aoMapIntensity = 0.75;
  }
  material.needsUpdate = true;
}

/**
 * Object-space box-projected UVs in metres / tile: each face takes the two
 * axes its normal does not point along. Keeps texel density uniform across
 * parts of any size, with no stretched grain.
 */
function boxUV(geometry: THREE.BufferGeometry, tile: number, grainAlongX = true): void {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i += 1) {
    const ax = Math.abs(normal.getX(i));
    const ay = Math.abs(normal.getY(i));
    const az = Math.abs(normal.getZ(i));
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    let u: number;
    let v: number;
    if (ax >= ay && ax >= az) {
      u = z;
      v = y;
    } else if (ay >= az) {
      u = x;
      v = z;
    } else {
      u = x;
      v = y;
    }
    if (!grainAlongX) [u, v] = [v, u];
    uv[i * 2] = u / tile;
    uv[i * 2 + 1] = v / tile;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

function roundedBox(
  width: number,
  height: number,
  depth: number,
  radius: number,
  tile: number,
  grainAlongX = true,
): THREE.BufferGeometry {
  const geometry = new RoundedBoxGeometry(width, height, depth, 3, radius);
  boxUV(geometry, tile, grainAlongX);
  return geometry;
}

/**
 * A surface of revolution from a profile of [radius, height] points, with
 * UVs in metres: around (snapped to whole tiles so the seam matches) and
 * along the profile's length.
 */
function lathe(
  profile: readonly (readonly [number, number])[],
  tile: number,
  segments = 64,
): THREE.BufferGeometry {
  const points = profile.map(([r, y]) => new THREE.Vector2(r, y));
  const geometry = new THREE.LatheGeometry(points, segments);
  const maxRadius = Math.max(...profile.map(([r]) => r));
  const around = Math.max(1, Math.round((Math.PI * 2 * maxRadius) / tile));
  const lengths = [0];
  for (let i = 1; i < points.length; i += 1) {
    lengths.push(lengths[i - 1] + points[i].distanceTo(points[i - 1]));
  }
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < uv.count; i += 1) {
    const segment = Math.round(uv.getX(i) * segments);
    const row = Math.round(uv.getY(i) * (points.length - 1));
    uv.setXY(i, (segment / segments) * around, lengths[row] / tile);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function add(
  builder: WorldBuilder,
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  shadows = true,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = shadows;
  mesh.receiveShadow = true;
  builder.track(mesh, parent);
  return mesh;
}

// ---- fountain ----------------------------------------------------------------

/** Vertical streaks for falling water, drawn once. */
function curtainTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const random = seeded(41);
  if (ctx) {
    ctx.fillStyle = "rgb(18,18,18)";
    ctx.fillRect(0, 0, 128, 256);
    for (let i = 0; i < 220; i += 1) {
      const x = random() * 128;
      const tone = 140 + random() * 115;
      ctx.fillStyle = `rgb(${tone},${tone},${tone})`;
      ctx.fillRect(x, random() * 256, 1 + random() * 2, 20 + random() * 90);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

/** Broken, blotchy white water for where the overflow lands. */
function foamTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const random = seeded(57);
  if (ctx) {
    ctx.fillStyle = "rgb(0,0,0)";
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 420; i += 1) {
      const x = random() * 256;
      const y = random() * 256;
      const r = 2 + random() * 9;
      const tone = Math.round(90 + random() * 165);
      // Wrap each blob so the tile repeats without a seam.
      for (const [dx, dy] of [[0, 0], [256, 0], [-256, 0], [0, 256], [0, -256]]) {
        ctx.fillStyle = `rgba(${tone},${tone},${tone},${0.5 + random() * 0.5})`;
        ctx.beginPath();
        ctx.ellipse(x + dx, y + dy, r * 1.6, r, random() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

interface Fountain {
  update(seconds: number): void;
}

function buildFountain(
  builder: WorldBuilder,
  stone: Surface,
  reducedMotion: boolean,
): Fountain {
  const group = builder.group();
  group.name = "fountain";

  // Basin: a plinth that flares into the ground, a moulding band, the wall,
  // a rounded bullnose lip, the inner face, and the pool floor.
  const R = 3.2;
  const basin = lathe(
    [
      [0, FOUNTAIN.poolFloor - 0.12],
      [FOUNTAIN.poolRadius - 0.08, FOUNTAIN.poolFloor - 0.12],
      [FOUNTAIN.poolRadius - 0.02, FOUNTAIN.poolFloor - 0.08],
      [FOUNTAIN.poolRadius, FOUNTAIN.rimTop - 0.06],
      [FOUNTAIN.poolRadius + 0.03, FOUNTAIN.rimTop - 0.01],
      [FOUNTAIN.poolRadius + 0.09, FOUNTAIN.rimTop],
      [R - 0.06, FOUNTAIN.rimTop],
      [R - 0.01, FOUNTAIN.rimTop - 0.025],
      [R + 0.02, FOUNTAIN.rimTop - 0.07],
      [R - 0.01, FOUNTAIN.rimTop - 0.11],
      [R - 0.06, FOUNTAIN.rimTop - 0.13],
      [R - 0.07, 0.32],
      [R - 0.03, 0.3],
      [R - 0.02, 0.24],
      [R - 0.06, 0.22],
      [R - 0.06, 0.12],
      [R + 0.04, 0.08],
      [R + 0.1, 0.02],
      [R + 0.1, -0.05],
    ].map(([r, y]) => [r, y] as const),
    stone.tile,
    96,
  );
  add(builder, group, basin, stone.material);

  // Pedestal and upper bowl: a turned column with a collar, the bowl's
  // curved underside, a rolled lip, and a finial that the jet leaves from.
  const column = lathe(
    [
      [0.78, FOUNTAIN.poolFloor - 0.12],
      [0.78, 0.4],
      [0.62, 0.48],
      [0.5, 0.55],
      [0.42, 0.7],
      [0.38, 1.0],
      [0.4, 1.22],
      [0.5, 1.28],
      [0.5, 1.34],
      [0.42, 1.38],
      [0.5, 1.45],
      [0.8, 1.56],
      [1.05, 1.68],
      [FOUNTAIN.columnRadius, 1.76],
      [FOUNTAIN.columnRadius + 0.02, 1.82],
      [FOUNTAIN.columnRadius - 0.04, 1.86],
      [FOUNTAIN.columnRadius - 0.1, 1.82],
      [0.6, 1.74],
      [0.22, 1.72],
      [0.2, 1.9],
      [0.26, 1.96],
      [0.16, 2.02],
      [0.12, 2.18],
      [0.16, 2.24],
      [0.09, 2.3],
      [0, 2.32],
    ].map(([r, y]) => [r, y] as const),
    stone.tile,
    64,
  );
  add(builder, group, column, stone.material);

  // Water: the pool and the bowl, glossy with drifting ripples that take the
  // sky's reflection.
  const ripples = rippleTexture(128);
  ripples.repeat.set(3, 3);
  builder.trackResource(ripples);
  const waterMaterial = new THREE.MeshPhysicalMaterial({
    color: "#1d6a73",
    roughness: 0.05,
    metalness: 0,
    transparent: true,
    opacity: 0.9,
    normalMap: ripples,
    normalScale: new THREE.Vector2(0.35, 0.35),
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  });
  const pool = new THREE.RingGeometry(0.7, FOUNTAIN.poolRadius + 0.01, 96, 1);
  pool.rotateX(-Math.PI / 2);
  pool.translate(0, FOUNTAIN.waterY, 0);
  add(builder, group, pool, waterMaterial, false);
  const bowlWater = new THREE.CircleGeometry(FOUNTAIN.columnRadius - 0.08, 48);
  bowlWater.rotateX(-Math.PI / 2);
  bowlWater.translate(0, 1.8, 0);
  add(builder, group, bowlWater, waterMaterial, false);

  // Overflow: a thin sheet falling from the bowl's lip into the pool, and a
  // ring of white water where it lands. Both scroll; neither casts shadow.
  const streaks = curtainTexture();
  streaks.repeat.set(10, 1);
  builder.trackResource(streaks);
  const curtainMaterial = new THREE.MeshStandardMaterial({
    color: "#e6f4f4",
    roughness: 0.2,
    transparent: true,
    opacity: 0.55,
    alphaMap: streaks,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const curtain = new THREE.CylinderGeometry(
    FOUNTAIN.columnRadius + 0.04,
    FOUNTAIN.columnRadius + 0.14,
    1.82 - FOUNTAIN.waterY,
    64,
    1,
    true,
  );
  curtain.translate(0, (1.82 + FOUNTAIN.waterY) / 2, 0);
  add(builder, group, curtain, curtainMaterial, false);
  const foamMap = foamTexture();
  foamMap.repeat.set(3, 3);
  builder.trackResource(foamMap);
  const foam = new THREE.RingGeometry(FOUNTAIN.columnRadius + 0.05, FOUNTAIN.columnRadius + 0.45, 64, 1);
  foam.rotateX(-Math.PI / 2);
  foam.translate(0, FOUNTAIN.waterY + 0.006, 0);
  const foamMaterial = new THREE.MeshStandardMaterial({
    color: "#f4fbfb",
    roughness: 0.6,
    transparent: true,
    opacity: 0.9,
    alphaMap: foamMap,
    depthWrite: false,
  });
  add(builder, group, foam, foamMaterial, false);

  // The jet: droplets thrown up from the finial, falling back into the bowl.
  const dropletCount = 120;
  const positions = new Float32Array(dropletCount * 3);
  const seeds = new Float32Array(dropletCount);
  const random = seeded(9);
  for (let i = 0; i < dropletCount; i += 1) seeds[i] = random();
  const dropletGeometry = new THREE.BufferGeometry();
  dropletGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const droplets = new THREE.Points(
    dropletGeometry,
    new THREE.PointsMaterial({ color: "#eef8f8", size: 0.05, transparent: true, opacity: 0.8, depthWrite: false }),
  );
  builder.track(droplets, group);

  return {
    update(seconds) {
      const flow = reducedMotion ? 0.25 : 1;
      ripples.offset.set(seconds * 0.02 * flow, seconds * 0.013 * flow);
      streaks.offset.y = seconds * 0.9 * flow;
      foamMap.offset.set(seconds * 0.05 * flow, -seconds * 0.04 * flow);
      if (reducedMotion) return;
      const attribute = dropletGeometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < dropletCount; i += 1) {
        const seed = seeds[i];
        const t = ((seconds * 0.85 + seed) % 1) * 0.7;
        const angle = seed * Math.PI * 2 * 7.3;
        const spread = t * (0.6 + seed * 0.5);
        attribute.setXYZ(
          i,
          Math.cos(angle) * spread,
          2.32 + 2.6 * t - 4.9 * t * t,
          Math.sin(angle) * spread,
        );
      }
      attribute.needsUpdate = true;
    },
  };
}

// ---- benches ------------------------------------------------------------------

/**
 * One bench, merged into two geometries — the wood and the cast iron — so
 * each bench costs two draw calls rather than one per slat and frame part.
 */
function benchGeometries(wood: Surface): { wood: THREE.BufferGeometry; iron: THREE.BufferGeometry } {
  const slats: THREE.BufferGeometry[] = [];
  // Seat: five slats with gaps, slightly crowned toward the middle.
  for (let i = 0; i < 5; i += 1) {
    const slat = roundedBox(2.6, 0.035, 0.085, 0.012, wood.tile);
    slat.translate(0, 0.46 + Math.sin((i / 4) * Math.PI) * 0.008, 0.2 - i * 0.1);
    slats.push(slat);
  }
  // Back: three slats leaning back.
  for (let i = 0; i < 3; i += 1) {
    const slat = roundedBox(2.6, 0.03, 0.09, 0.012, wood.tile);
    const lift = 0.62 + i * 0.11;
    slat.rotateX(-0.21);
    slat.translate(0, lift, -0.27 - (lift - 0.6) * 0.21);
    slats.push(slat);
  }
  // Cast frames at both ends and one in the middle.
  const frames: THREE.BufferGeometry[] = [];
  for (const side of [-1.18, 0, 1.18]) {
    for (const piece of benchFrame()) {
      piece.translate(side, 0, 0);
      frames.push(piece);
    }
  }
  const merged = {
    wood: mergeGeometries(slats) as THREE.BufferGeometry,
    iron: mergeGeometries(frames) as THREE.BufferGeometry,
  };
  for (const part of [...slats, ...frames]) part.dispose();
  return merged;
}

function buildBench(
  builder: WorldBuilder,
  x: number,
  z: number,
  rotation: number,
  wood: Surface,
  iron: THREE.Material,
  parts: { wood: THREE.BufferGeometry; iron: THREE.BufferGeometry },
): void {
  const group = builder.group();
  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  add(builder, group, parts.wood, wood.material);
  add(builder, group, parts.iron, iron);
}

/** One bench end frame: legs, seat rail, back upright, armrest (ends only show it). */
function benchFrame(): THREE.BufferGeometry[] {
  const make = (w: number, h: number, d: number, x: number, y: number, z: number, tilt = 0) => {
    const geometry = new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.35);
    geometry.rotateX(tilt);
    geometry.translate(x, y, z);
    return geometry;
  };
  return [
    make(0.06, 0.46, 0.06, 0, 0.23, 0.2, 0.08), // front leg
    make(0.06, 0.48, 0.06, 0, 0.24, -0.25, -0.1), // back leg
    make(0.06, 0.05, 0.56, 0, 0.42, -0.02), // seat rail
    make(0.06, 0.52, 0.05, 0, 0.7, -0.33, -0.21), // back upright
    make(0.055, 0.04, 0.5, 0, 0.66, -0.02), // armrest
    make(0.05, 0.22, 0.05, 0, 0.55, 0.2, 0.05), // armrest post
  ];
}

// ---- planters -------------------------------------------------------------------

function buildPlanter(
  builder: WorldBuilder,
  x: number,
  z: number,
  masonry: Surface,
  cap: Surface,
  soil: THREE.Material,
  parts: { body: THREE.BufferGeometry; capLong: THREE.BufferGeometry; capShort: THREE.BufferGeometry; soil: THREE.BufferGeometry },
): THREE.Group {
  const group = builder.group();
  group.position.set(x, 0, z);
  add(builder, group, parts.body, masonry.material);
  for (const side of [-1, 1]) {
    const long = add(builder, group, parts.capLong, cap.material);
    long.position.set(0, 0.55, side * 0.6);
    const short = add(builder, group, parts.capShort, cap.material);
    short.position.set(side * 1.45, 0.55, 0);
  }
  const earth = add(builder, group, parts.soil, soil, false);
  earth.position.y = 0.53;
  return group;
}

// ---- lamp posts ---------------------------------------------------------------------

function buildPost(
  builder: WorldBuilder,
  x: number,
  z: number,
  iron: THREE.Material,
  parts: { post: THREE.BufferGeometry; arm: THREE.BufferGeometry },
): THREE.Group {
  const group = builder.group();
  group.position.set(x, 0, z);
  // Arms point toward the plaza's middle, so the lantern hangs over the path.
  group.rotation.y = Math.atan2(-x, -z);
  add(builder, group, parts.post, iron);
  add(builder, group, parts.arm, iron);
  return group;
}

// ---- assembly -------------------------------------------------------------------------

export interface PlazaProps {
  deferred: readonly import("../startup").DeferredWorldTask[];
  update(seconds: number): void;
}

export function buildPlazaProps(
  builder: WorldBuilder,
  options: {
    benches: readonly (readonly [number, number, number])[];
    planters: readonly (readonly [number, number])[];
    lanterns: readonly (readonly [number, number])[];
    assets: BeachAssets;
    signal: AbortSignal;
    reducedMotion: boolean;
  },
): PlazaProps {
  const limestone = surface("#d9cdb4", 1.36, 0.85, new THREE.Color(1.15, 1.12, 1.05));
  const masonry = surface("#c9b796", 2.0, 0.9, new THREE.Color(1.2, 1.12, 1.0));
  // The scan is a dark walnut; lifted toward weathered teak.
  const wood = surface("#9a7452", 0.6, 0.62, new THREE.Color(1.9, 1.6, 1.3));
  const iron = new THREE.MeshStandardMaterial({ color: "#2c2a26", roughness: 0.42, metalness: 0.75 });
  const soil = new THREE.MeshStandardMaterial({ color: "#5a4632", roughness: 1 });

  const fountain = buildFountain(builder, limestone, options.reducedMotion);

  const benchParts = benchGeometries(wood);
  for (const [x, z, rotation] of options.benches) {
    buildBench(builder, x, z, rotation, wood, iron, benchParts);
  }

  const planterParts = {
    body: (() => {
      const geometry = roundedBox(2.9, 0.52, 1.2, 0.03, masonry.tile);
      geometry.translate(0, 0.26, 0);
      return geometry;
    })(),
    capLong: roundedBox(3.08, 0.08, 0.16, 0.025, limestone.tile),
    capShort: roundedBox(0.16, 0.08, 1.06, 0.025, limestone.tile),
    soil: (() => {
      const geometry = new THREE.BoxGeometry(2.76, 0.04, 1.06);
      return geometry;
    })(),
  };
  const planters = options.planters.map(([x, z]) =>
    buildPlanter(builder, x, z, masonry, limestone, soil, planterParts),
  );

  const postParts = {
    post: lathe(
      [
        [0, 0],
        [0.17, 0],
        [0.17, 0.06],
        [0.13, 0.1],
        [0.13, 0.22],
        [0.08, 0.3],
        [0.055, 0.42],
        [0.045, 2.7],
        [0.07, 2.74],
        [0.07, 2.8],
        [0.05, 2.84],
        [0.05, 2.96],
        [0.08, 3.0],
        [0.02, 3.1],
        [0, 3.12],
      ],
      1,
      20,
    ),
    arm: (() => {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 2.86, 0),
        new THREE.Vector3(0, 2.94, 0.18),
        new THREE.Vector3(0, 2.9, 0.38),
        new THREE.Vector3(0, 2.8, 0.46),
      ]);
      return new THREE.TubeGeometry(curve, 24, 0.018, 8, false);
    })(),
  };
  const posts = options.lanterns.map(([x, z]) => buildPost(builder, x, z, iron, postParts));

  return {
    // No requests during construction. The engine schedules these refinements.
    deferred: [
      () => dress(limestone, "coral_fort_wall_01", options.assets, options.signal),
      () => dress(masonry, "coral_stone_wall", options.assets, options.signal),
      () => dress(wood, "fine_grained_wood", options.assets, options.signal),
      () => hangLanterns(builder, posts, options.assets, options.signal),
      () => plantPlanters(builder, planters, options.assets, options.signal),
    ],
    update(seconds) {
      fountain.update(seconds);
    },
  };
}

// ---- scanned models ---------------------------------------------------------------------

async function scannedMaterial(
  assets: BeachAssets,
  name: string,
  size: number,
  options: { alpha?: boolean; glass?: boolean },
): Promise<THREE.MeshStandardMaterial> {
  const load = (slot: string, colorSpace: THREE.ColorSpace, file = `${name}_${slot}_${size}.jpg`) =>
    assets.texture(file, colorSpace, { flipY: false }).catch((error: unknown) => {
      if (error instanceof LoadAborted) throw error;
      return null;
    });
  const [map, normal, orm, alpha] = await Promise.all([
    load("color", THREE.SRGBColorSpace),
    load("normal", THREE.NoColorSpace),
    load("orm", THREE.NoColorSpace),
    options.alpha ? load("alpha", THREE.NoColorSpace, `${name}_alpha_1k.jpg`) : Promise.resolve(null),
  ]);
  if (options.glass) {
    return new THREE.MeshPhysicalMaterial({
      color: "#fff4dc",
      roughness: 0.08,
      metalness: 0,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }
  return new THREE.MeshStandardMaterial({
    map,
    normalMap: normal,
    normalScale: new THREE.Vector2(1, -1),
    roughnessMap: orm,
    metalnessMap: orm,
    aoMap: orm,
    roughness: 1,
    metalness: options.alpha ? 0 : 1,
    alphaMap: alpha,
    alphaTest: alpha ? 0.45 : 0,
    side: options.alpha ? THREE.DoubleSide : THREE.FrontSide,
  });
}

/** Meshes of a loaded model, recentred so each sits on its own base at the origin. */
function partsOf(gltf: GLTF): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.applyMatrix4(mesh.matrixWorld);
    meshes.push(mesh);
  });
  return meshes;
}

async function hangLanterns(
  builder: WorldBuilder,
  posts: THREE.Group[],
  assets: BeachAssets,
  signal: AbortSignal,
): Promise<void> {
  let gltf: GLTF | null = null;
  try {
    gltf = await assets.model("lantern.glb");
    const [brass, glass] = await Promise.all([
      scannedMaterial(assets, "Lantern_01_brass", 512, {}),
      scannedMaterial(assets, "Lantern_01_glass", 512, { glass: true }),
    ]);
    if (signal.aborted) {
      disposeGltf(gltf);
      for (const material of [brass, glass]) material.dispose();
      return;
    }
    const meshes = partsOf(gltf);
    // One bounding box for the whole lantern: it hangs by its top ring.
    const box = new THREE.Box3();
    for (const mesh of meshes) box.expandByObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    const scale = 0.42 / size.y;
    const flame = new THREE.MeshStandardMaterial({
      color: "#ffd9a0",
      emissive: "#ffb75e",
      emissiveIntensity: 2.2,
    });
    const flameGeometry = new THREE.SphereGeometry(0.035, 12, 8);
    flameGeometry.scale(1, 1.6, 1);
    for (const post of posts) {
      const lantern = new THREE.Group();
      lantern.position.set(0, 2.8 - size.y * scale, 0.46);
      lantern.scale.setScalar(scale);
      for (const mesh of meshes) {
        const part = new THREE.Mesh(
          mesh.geometry,
          (mesh.material as THREE.Material).name.includes("glass") ? glass : brass,
        );
        part.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
        part.castShadow = !(mesh.material as THREE.Material).name.includes("glass");
        lantern.add(part);
      }
      const glow = new THREE.Mesh(flameGeometry, flame);
      glow.position.set(0, (size.y * 0.42) , 0);
      lantern.add(glow);
      builder.track(lantern, post);
    }
    for (const mesh of meshes) (mesh.material as THREE.Material).dispose();
  } catch (error) {
    if (gltf && signal.aborted) disposeGltf(gltf);
    if (!(error instanceof LoadAborted)) console.warn("[plaza] lantern unavailable");
  }
}

/** Plants per planter: species and how many of each, scattered along the box. */
const PLANTINGS: readonly { model: string; material: string; height: number }[] = [
  { model: "anthurium.glb", material: "anthurium_botany_01", height: 0.75 },
  { model: "calathea.glb", material: "calathea_orbifolia_01", height: 0.6 },
  { model: "fern.glb", material: "fern_02", height: 0.65 },
];

async function plantPlanters(
  builder: WorldBuilder,
  planters: THREE.Group[],
  assets: BeachAssets,
  signal: AbortSignal,
): Promise<void> {
  const species = await Promise.all(
    PLANTINGS.map(async (planting) => {
      try {
        const gltf = await assets.model(planting.model);
        const material = await scannedMaterial(assets, planting.material, 1024, { alpha: true });
        if (signal.aborted) {
          disposeGltf(gltf);
          material.dispose();
          return null;
        }
        const variants = partsOf(gltf).map((mesh) => {
          (mesh.material as THREE.Material).dispose();
          const geometry = mesh.geometry;
          geometry.computeBoundingBox();
          const box = geometry.boundingBox as THREE.Box3;
          const centre = box.getCenter(new THREE.Vector3());
          geometry.translate(-centre.x, -box.min.y, -centre.z);
          const height = box.max.y - box.min.y;
          geometry.scale(planting.height / height, planting.height / height, planting.height / height);
          return geometry;
        });
        return { variants, material };
      } catch (error) {
        if (!(error instanceof LoadAborted)) console.warn(`[plaza] plant unavailable: ${planting.model}`);
        return null;
      }
    }),
  );
  if (signal.aborted) return;
  const available = species.filter((entry): entry is NonNullable<typeof entry> => !!entry);
  if (available.length === 0) return;
  planters.forEach((planter, index) => {
    const random = seeded(300 + index * 17);
    const count = 5;
    for (let i = 0; i < count; i += 1) {
      const kind = available[(i + index) % available.length];
      const geometry = kind.variants[Math.floor(random() * kind.variants.length)];
      const plant = new THREE.Mesh(geometry, kind.material);
      plant.position.set(-1.1 + (i / (count - 1)) * 2.2 + (random() - 0.5) * 0.18, 0.55, (random() - 0.5) * 0.4);
      plant.rotation.y = random() * Math.PI * 2;
      plant.scale.setScalar(0.85 + random() * 0.35);
      plant.castShadow = true;
      plant.receiveShadow = true;
      builder.track(plant, planter);
    }
  });
}
