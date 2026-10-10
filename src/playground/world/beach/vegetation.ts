/**
 * Coconut palms, planter ferns and dune grass.
 *
 * Built procedurally rather than loaded: no openly licensed palm model was
 * both redistributable and light enough, and a generator lets every palm
 * differ in height, lean and crown from one seed while all of them together
 * cost three draw calls. Fronds are V-folded strips whose leaflets are an
 * alpha-tested texture drawn once into a canvas at mount.
 *
 * Wind bends trunks and fronds in the vertex shader, and the shadow pass uses
 * a depth material with the same bend, so a palm's shade moves with its
 * leaves. The wind blows onshore, the way the waves travel.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Onshore breeze, unit xz (toward land, +Z), matching the swell. */
const WIND = new THREE.Vector3(0.12, 0, 1).normalize();

/** Deterministic PRNG so every visitor sees the same palms. */
export function seeded(seed: number): () => number {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

// ---- textures -------------------------------------------------------------

function frondTexture(): THREE.CanvasTexture {
  const width = 256;
  const height = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const random = seeded(11);
  if (ctx) {
    ctx.clearRect(0, 0, width, height);
    // v=0 (base) at the bottom of the canvas, tip at the top.
    for (let i = 0; i < 150; i += 1) {
      const v = 0.04 + (i / 150) * 0.94;
      const y = height * (1 - v);
      for (const side of [-1, 1]) {
        if (random() < 0.06) continue; // the odd missing leaflet
        const reach = (0.42 + random() * 0.08) * width;
        const sweep = height * (0.06 + 0.05 * v); // leaflets point toward the tip
        const tipX = width / 2 + side * reach;
        const tipY = y - sweep;
        const base = 3.2 * (1 - v * 0.5);
        const shade = 0.75 + random() * 0.3;
        const g = Math.round(118 * shade + 40 * v);
        const r = Math.round(62 * shade + 70 * v * v);
        ctx.fillStyle = `rgb(${r},${g},${Math.round(38 * shade)})`;
        ctx.beginPath();
        ctx.moveTo(width / 2, y - base);
        ctx.quadraticCurveTo(
          width / 2 + side * reach * 0.5,
          y - sweep * 0.25 - base * 3,
          tipX,
          tipY,
        );
        ctx.quadraticCurveTo(
          width / 2 + side * reach * 0.5,
          y - sweep * 0.25 + base * 2,
          width / 2,
          y + base,
        );
        ctx.closePath();
        ctx.fill();
      }
    }
    // Rachis down the middle.
    ctx.strokeStyle = "rgb(140,132,70)";
    for (let y = 0; y < height; y += 4) {
      ctx.lineWidth = 7 * (y / height) + 2;
      ctx.beginPath();
      ctx.moveTo(width / 2, y);
      ctx.lineTo(width / 2, y + 5);
      ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function barkTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  const random = seeded(23);
  if (ctx) {
    ctx.fillStyle = "rgb(128,112,92)";
    ctx.fillRect(0, 0, 128, 512);
    // Leaf-scar rings: roughly every quarter metre (the texture is 1m tall).
    for (let ring = 0; ring < 4; ring += 1) {
      const y = ring * 128 + random() * 20;
      for (let x = 0; x < 128; x += 2) {
        const wobble = Math.sin(x * 0.09 + ring) * 6;
        ctx.fillStyle = `rgba(70,58,46,${0.55 + random() * 0.3})`;
        ctx.fillRect(x, y + wobble, 2, 10 + random() * 6);
      }
    }
    // Vertical fibres.
    for (let i = 0; i < 900; i += 1) {
      const tone = 100 + random() * 70;
      ctx.fillStyle = `rgba(${tone},${tone * 0.88},${tone * 0.72},0.35)`;
      ctx.fillRect(random() * 128, random() * 512, 1, 6 + random() * 24);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function grassTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const random = seeded(31);
  if (ctx) {
    ctx.clearRect(0, 0, 256, 256);
    for (let i = 0; i < 60; i += 1) {
      const x = 40 + random() * 176;
      const lean = (random() - 0.5) * 120;
      const tall = 120 + random() * 130;
      const tone = random();
      ctx.strokeStyle = `rgb(${Math.round(120 + tone * 70)},${Math.round(130 + tone * 50)},${Math.round(70 + tone * 20)})`;
      ctx.lineWidth = 2 + random() * 2;
      ctx.beginPath();
      ctx.moveTo(x, 256);
      ctx.quadraticCurveTo(
        x + lean * 0.3,
        256 - tall * 0.6,
        x + lean,
        256 - tall,
      );
      ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// ---- wind ------------------------------------------------------------------

export interface WindUniforms {
  uTime: { value: number };
  uWindStrength: { value: number };
  uWindDirection: { value: THREE.Vector2 };
}

/**
 * Bend vertices by their `aSway` attribute: x is how much of the trunk's
 * sway this vertex rides (0 at the root, 1 in the crown), y how far out along
 * a frond or blade it is.
 */
function addWind(
  material: THREE.Material,
  wind: WindUniforms,
  key: string,
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = wind.uTime;
    shader.uniforms.uWindStrength = wind.uWindStrength;
    shader.uniforms.uWindDirection = wind.uWindDirection;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute vec2 aSway;
uniform float uTime;
uniform float uWindStrength;
uniform vec2 uWindDirection;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
{
  float phase = position.x * 0.21 + position.z * 0.17;
  float gust = 0.65 + 0.35 * sin(uTime * 0.37 + phase * 0.3);
  float trunk = aSway.x * aSway.x * (0.18 + 0.08 * sin(uTime * 0.9 + phase)) * gust;
  float frond = aSway.y * aSway.y * (0.32 + 0.2 * sin(uTime * 2.1 + phase * 3.0)) * gust;
  transformed += vec3(uWindDirection.x, 0.0, uWindDirection.y) * (trunk + frond) * uWindStrength;
  transformed.y += aSway.y * aSway.y * sin(uTime * 2.7 + phase * 5.0) * 0.07 * uWindStrength;
}`,
      );
  };
  material.customProgramCacheKey = () => key;
}

// ---- geometry ----------------------------------------------------------------

interface PalmSpec {
  x: number;
  z: number;
  height: number;
  /** Unit xz the trunk leans toward. */
  leanX: number;
  leanZ: number;
  lean: number;
  seed: number;
}

function trunkCurve(spec: PalmSpec): (t: number) => THREE.Vector3 {
  return (t) =>
    new THREE.Vector3(
      spec.x + spec.leanX * spec.lean * Math.pow(t, 1.7),
      spec.height * t,
      spec.z + spec.leanZ * spec.lean * Math.pow(t, 1.7),
    );
}

function trunkGeometry(spec: PalmSpec): THREE.BufferGeometry {
  const rings = 22;
  const sides = 10;
  const curve = trunkCurve(spec);
  const positions: number[] = [];
  const uvs: number[] = [];
  const sway: number[] = [];
  const indices: number[] = [];
  const up = new THREE.Vector3();
  const side = new THREE.Vector3();
  const forward = new THREE.Vector3();
  for (let ring = 0; ring <= rings; ring += 1) {
    const t = ring / rings;
    const center = curve(t);
    up.copy(curve(Math.min(1, t + 0.01)))
      .sub(curve(Math.max(0, t - 0.01)))
      .normalize();
    side.set(1, 0, 0).sub(up.clone().multiplyScalar(up.x)).normalize();
    forward.crossVectors(up, side);
    const radius = 0.2 * (1.25 - 0.4 * t) * (1 + 0.6 * Math.exp(-t * 16));
    for (let s = 0; s <= sides; s += 1) {
      const angle = (s / sides) * Math.PI * 2;
      const bump = 1 + 0.03 * Math.sin(t * spec.height * 25.1 + s);
      positions.push(
        center.x +
          (side.x * Math.cos(angle) + forward.x * Math.sin(angle)) *
            radius *
            bump,
        center.y +
          (side.y * Math.cos(angle) + forward.y * Math.sin(angle)) *
            radius *
            bump,
        center.z +
          (side.z * Math.cos(angle) + forward.z * Math.sin(angle)) *
            radius *
            bump,
      );
      uvs.push(s / sides, t * spec.height);
      sway.push(t, 0);
    }
  }
  for (let ring = 0; ring < rings; ring += 1) {
    for (let s = 0; s < sides; s += 1) {
      const a = ring * (sides + 1) + s;
      const b = a + sides + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("aSway", new THREE.Float32BufferAttribute(sway, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * One frond: a strip along a drooping spine, folded into a shallow V so the
 * leaflets catch light from both sides.
 */
function frondGeometry(
  origin: THREE.Vector3,
  azimuth: number,
  elevation: number,
  length: number,
  droop: number,
  tint: THREE.Color,
  swayBase: number,
): THREE.BufferGeometry {
  const segments = 14;
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const sway: number[] = [];
  const indices: number[] = [];
  const point = origin.clone();
  const step = length / segments;
  const horizontal = new THREE.Vector3(
    Math.sin(azimuth),
    0,
    -Math.cos(azimuth),
  );
  const lateral = new THREE.Vector3(Math.cos(azimuth), 0, Math.sin(azimuth));
  for (let i = 0; i <= segments; i += 1) {
    const v = i / segments;
    const pitch = elevation - droop * Math.pow(v, 1.6);
    const direction = horizontal
      .clone()
      .multiplyScalar(Math.cos(pitch))
      .add(new THREE.Vector3(0, Math.sin(pitch), 0));
    if (i > 0) point.addScaledVector(direction, step);
    const halfWidth =
      length *
      0.24 *
      (0.18 + 0.82 * Math.pow(Math.sin(Math.PI * Math.min(1, v * 1.05)), 0.55));
    const lift = halfWidth * (0.42 - 0.5 * v); // the V flattens toward the tip
    const surfaceUp = new THREE.Vector3()
      .crossVectors(lateral, direction)
      .normalize();
    for (const across of [-1, 0, 1]) {
      const p = point
        .clone()
        .addScaledVector(lateral, across * halfWidth)
        .addScaledVector(surfaceUp, across === 0 ? 0 : lift);
      positions.push(p.x, p.y, p.z);
      uvs.push((across + 1) / 2, v);
      colors.push(tint.r, tint.g, tint.b);
      sway.push(swayBase, v);
    }
  }
  for (let i = 0; i < segments; i += 1) {
    const a = i * 3;
    const b = a + 3;
    indices.push(
      a,
      b,
      a + 1,
      a + 1,
      b,
      b + 1,
      a + 1,
      b + 1,
      a + 2,
      a + 2,
      b + 1,
      b + 2,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("aSway", new THREE.Float32BufferAttribute(sway, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function crownFronds(
  top: THREE.Vector3,
  random: () => number,
  scale: number,
  count: number,
  swayBase: number,
): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const golden = 2.39996;
  const start = random() * Math.PI * 2;
  for (let i = 0; i < count; i += 1) {
    const age = i / (count - 1); // 0 young (upright), 1 old (hanging)
    const elevation =
      THREE.MathUtils.lerp(0.95, -0.15, age) + (random() - 0.5) * 0.2;
    const length = scale * (3.2 + random() * 1.1) * (age > 0.85 ? 0.9 : 1);
    const droop = THREE.MathUtils.lerp(0.9, 1.6, age) + random() * 0.3;
    const old = age > 0.8 && random() < 0.6;
    const tint = old
      ? new THREE.Color().setRGB(1.25, 1.0, 0.55)
      : new THREE.Color().setRGB(
          0.9 + random() * 0.2,
          0.95 + random() * 0.15,
          0.85 + random() * 0.15,
        );
    out.push(
      frondGeometry(
        top,
        start + i * golden,
        elevation,
        length,
        droop,
        tint,
        swayBase,
      ),
    );
  }
  return out;
}

// ---- assembly ----------------------------------------------------------------

export interface PalmPlacement {
  x: number;
  z: number;
  /** The old tree's scale; palms keep their relative heights. */
  scale: number;
}

export interface Vegetation {
  objects: THREE.Object3D[];
  resources: { dispose(): void }[];
  wind: WindUniforms;
}

export function createVegetation(
  palms: readonly PalmPlacement[],
  planters: readonly (readonly [number, number])[],
  grass: readonly (readonly [number, number, number])[],
  reducedMotion: boolean,
): Vegetation {
  const wind: WindUniforms = {
    uTime: { value: 0 },
    uWindStrength: { value: reducedMotion ? 0 : 1 },
    uWindDirection: { value: new THREE.Vector2(WIND.x, WIND.z) },
  };
  const frondMap = frondTexture();
  const barkMap = barkTexture();
  const grassMap = grassTexture();

  const trunks: THREE.BufferGeometry[] = [];
  const fronds: THREE.BufferGeometry[] = [];
  const nuts: THREE.BufferGeometry[] = [];
  const nutShape = new THREE.SphereGeometry(0.11, 8, 6);

  palms.forEach((placement, index) => {
    const random = seeded(1000 + index * 97);
    const height = 3.6 * placement.scale + 1.2 + random() * 1.4;
    // Lean away from the sea and a little at random: palms grow toward the light.
    const azimuth = Math.PI + (random() - 0.5) * 1.8;
    const spec: PalmSpec = {
      x: placement.x,
      z: placement.z,
      height,
      leanX: Math.sin(azimuth),
      leanZ: -Math.cos(azimuth),
      lean: 0.4 + random() * 1.1,
      seed: index,
    };
    trunks.push(trunkGeometry(spec));
    const top = trunkCurve(spec)(1);
    fronds.push(
      ...crownFronds(
        top,
        random,
        0.85 + placement.scale * 0.12,
        11 + Math.floor(random() * 4),
        1,
      ),
    );
    for (let n = 0; n < 4; n += 1) {
      const angle = random() * Math.PI * 2;
      const nut = nutShape.clone();
      nut.translate(
        top.x + Math.cos(angle) * 0.22,
        top.y - 0.25 - random() * 0.12,
        top.z + Math.sin(angle) * 0.22,
      );
      const sway = new Float32Array(
        nut.getAttribute("position").count * 2,
      ).fill(1);
      for (let k = 1; k < sway.length; k += 2) sway[k] = 0;
      nut.setAttribute("aSway", new THREE.BufferAttribute(sway, 2));
      nuts.push(nut);
    }
  });

  // Planter ferns: short fronds from the soil, no trunk.
  planters.forEach(([x, z], index) => {
    const random = seeded(500 + index * 13);
    for (let cluster = -1; cluster <= 1; cluster += 1) {
      const base = new THREE.Vector3(x + cluster * 0.9, 0.62, z);
      fronds.push(...crownFronds(base, random, 0.32, 7, 0.15));
    }
  });

  const objects: THREE.Object3D[] = [];
  const resources: { dispose(): void }[] = [
    frondMap,
    barkMap,
    grassMap,
    nutShape,
  ];

  const barkMaterial = new THREE.MeshStandardMaterial({
    map: barkMap,
    bumpMap: barkMap,
    bumpScale: 2.5,
    roughness: 0.95,
  });
  addWind(barkMaterial, wind, "plaza-palm-bark");
  const trunkMesh = new THREE.Mesh(mergeGeometries(trunks), barkMaterial);
  trunks.forEach((geometry) => geometry.dispose());

  const frondMaterial = new THREE.MeshStandardMaterial({
    map: frondMap,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    vertexColors: true,
    roughness: 0.62,
  });
  addWind(frondMaterial, wind, "plaza-palm-frond");
  const frondMesh = new THREE.Mesh(mergeGeometries(fronds), frondMaterial);
  fronds.forEach((geometry) => geometry.dispose());

  const nutMaterial = new THREE.MeshStandardMaterial({
    color: "#5d4a2c",
    roughness: 0.7,
  });
  addWind(nutMaterial, wind, "plaza-palm-nut");
  const nutMesh = new THREE.Mesh(mergeGeometries(nuts), nutMaterial);
  nuts.forEach((geometry) => geometry.dispose());

  for (const [mesh, map, alpha] of [
    [trunkMesh, null, 0],
    [frondMesh, frondMap, 0.5],
    [nutMesh, null, 0],
  ] as const) {
    // The shadow must bend with the leaves, so its depth pass gets the same wind.
    const depth = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map,
      alphaTest: alpha,
      side: THREE.DoubleSide,
    });
    addWind(depth, wind, `${mesh === frondMesh ? "frond" : "solid"}-depth`);
    mesh.customDepthMaterial = depth;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    objects.push(mesh);
  }

  if (grass.length > 0) {
    const blades: THREE.BufferGeometry[] = [];
    for (const [x, z, y] of grass) {
      for (let card = 0; card < 3; card += 1) {
        const plane = new THREE.PlaneGeometry(0.9, 0.7, 1, 2);
        plane.translate(0, 0.35, 0);
        plane.rotateY((card / 3) * Math.PI + x);
        plane.translate(x, y - 0.03, z);
        const count = plane.getAttribute("position").count;
        const sway = new Float32Array(count * 2);
        const uv = plane.getAttribute("uv");
        for (let k = 0; k < count; k += 1) {
          sway[k * 2] = 0;
          sway[k * 2 + 1] = uv.getY(k) * 0.6;
        }
        plane.setAttribute("aSway", new THREE.BufferAttribute(sway, 2));
        blades.push(plane);
      }
    }
    const grassMaterial = new THREE.MeshStandardMaterial({
      map: grassMap,
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      roughness: 0.9,
    });
    addWind(grassMaterial, wind, "plaza-grass");
    const grassMesh = new THREE.Mesh(mergeGeometries(blades), grassMaterial);
    blades.forEach((geometry) => geometry.dispose());
    grassMesh.receiveShadow = true;
    objects.push(grassMesh);
  }

  return { objects, resources, wind };
}
