#!/usr/bin/env node
/**
 * Rebuild the beach's distributed assets from their CC0 sources.
 *
 *   node scripts/build-beach-assets.mjs
 *
 * Downloads the pinned Poly Haven sources into `assets/source/cache/`
 * (gitignored — the raw scans are tens of megabytes and are never shipped),
 * reduces them, writes the distributed files under `public/assets/beach/`,
 * and records each output's size, triangle count and SHA-256 in
 * `assets/beach-manifest.json`. Licences and modifications are listed in
 * `ASSET_LICENSES.md`.
 *
 * Mesh reduction uses `@gltf-transform/cli` through `npx`, and texture
 * extraction `@gltf-transform/core` installed into the cache, both pinned
 * below, rather than devDependencies: `npm ci` runs inside the capsule build,
 * and their native image dependency has no business there.
 *
 * Rock models ship as geometry-only GLB plus separate same-origin JPEGs. A
 * GLB with embedded images makes three's GLTFLoader fetch them from `blob:`
 * URLs, which the static-web CSP (`connect-src 'self'`) refuses in Chrome and
 * Firefox — and widening every app's CSP for that is not on the table.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, "assets/source/cache");
const OUT = join(ROOT, "public/assets/beach");
const GLTF_TRANSFORM = "@gltf-transform/cli@4.2.1";
const GLTF_CORE = "@gltf-transform/core@4.2.1";
const TOOLS = join(CACHE, "tools");
const POLY_HAVEN = "https://api.polyhaven.com/files";

/** Ground textures: Poly Haven slug → maps → distributed name. 1K JPEG as published. */
const TEXTURES = [
  { slug: "sand_03", maps: { Diffuse: "diff", nor_gl: "nor", arm: "arm" } },
  { slug: "aerial_beach_01", maps: { Diffuse: "diff", nor_gl: "nor" } },
  // Props: coral limestone (fountain), coral stone masonry (planters),
  // teak-like fine grain (bench slats).
  { slug: "coral_fort_wall_01", maps: { Diffuse: "diff", nor_gl: "nor", arm: "arm" } },
  { slug: "coral_stone_wall", maps: { Diffuse: "diff", nor_gl: "nor", arm: "arm" } },
  { slug: "fine_grained_wood", maps: { Diffuse: "diff", nor_gl: "nor", arm: "arm" } },
];

/**
 * Scanned props shipped as geometry-only GLB (node and material NAMES kept,
 * so code can rebuild each material) plus per-material JPEG maps named
 * `<material>_<slot>_<size>.jpg`. Plants also ship their alpha cutout map
 * (Poly Haven publishes it separately; their glTF uses MASK).
 */
const PROPS = [
  { slug: "Lantern_01", name: "lantern", ratio: 0.18, size: 512, alpha: false },
  { slug: "anthurium_botany_01", name: "anthurium", ratio: 0.12, size: 1024, alpha: true },
  { slug: "calathea_orbifolia_01", name: "calathea", ratio: 0.4, size: 1024, alpha: true },
  { slug: "fern_02", name: "fern", ratio: 1, size: 1024, alpha: true },
];

/**
 * Rocks: three silhouettes (block, slab, round), each at two levels of detail.
 * Ratios were chosen by looking at the result at walking distance — the
 * scans are 110–180k triangles, the plaza needs a few thousand.
 */
const ROCKS = [
  { slug: "namaqualand_boulder_03", name: "rock-block", lod0: 0.02, lod1: 0.004 },
  { slug: "namaqualand_boulder_05", name: "rock-slab", lod0: 0.018, lod1: 0.004 },
  { slug: "namaqualand_boulder_04", name: "rock-round", lod0: 0.02, lod1: 0.004 },
];

async function download(url, file) {
  if (existsSync(file)) return;
  mkdirSync(dirname(file), { recursive: true });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
}

async function files(slug) {
  const response = await fetch(`${POLY_HAVEN}/${slug}`);
  if (!response.ok) throw new Error(`${response.status} ${slug}`);
  return response.json();
}

function gltf(...args) {
  execFileSync("npx", ["--yes", GLTF_TRANSFORM, ...args], {
    cwd: ROOT,
    stdio: ["ignore", "ignore", "inherit"],
  });
}

/** Triangle count straight from the GLB's JSON chunk: index count / 3. */
function triangles(file) {
  const bytes = readFileSync(file);
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString("utf8"));
  let total = 0;
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      total += json.accessors[primitive.indices].count / 3;
    }
  }
  return total;
}

const manifest = [];
function record(file, extra = {}) {
  const bytes = readFileSync(file);
  manifest.push({
    path: relative(join(ROOT, "public"), file),
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    ...extra,
  });
}

mkdirSync(join(OUT, "textures"), { recursive: true });
mkdirSync(join(OUT, "models"), { recursive: true });

for (const { slug, maps } of TEXTURES) {
  const listing = await files(slug);
  for (const [map, short] of Object.entries(maps)) {
    const url = listing[map]["1k"].jpg.url;
    const cached = join(CACHE, slug, `${short}.jpg`);
    await download(url, cached);
    const target = join(OUT, "textures", `${slug}_${short}_1k.jpg`);
    copyFileSync(cached, target);
    record(target, { source: url, dimensions: "1024x1024" });
  }
}

// Core API for the extraction step, installed once into the cache.
if (!existsSync(join(TOOLS, "node_modules/@gltf-transform/core"))) {
  mkdirSync(TOOLS, { recursive: true });
  execFileSync("npm", ["install", "--no-save", "--prefix", TOOLS, GLTF_CORE], {
    stdio: ["ignore", "ignore", "inherit"],
  });
}
const { NodeIO } = await import(
  pathToFileURL(join(TOOLS, "node_modules/@gltf-transform/core/dist/index.modern.js")).href
);
const io = new NodeIO();

/** Write a texture's encoded bytes out; true when the slot had one. */
function extract(texture, file) {
  if (!texture) return false;
  writeFileSync(file, Buffer.from(texture.getImage()));
  return true;
}

for (const { slug, name, lod0, lod1 } of ROCKS) {
  const listing = (await files(slug)).gltf["1k"].gltf;
  const base = join(CACHE, slug);
  const entry = join(base, `${slug}.gltf`);
  await download(listing.url, entry);
  for (const [path, include] of Object.entries(listing.include)) {
    await download(include.url, join(base, path));
  }
  for (const [lod, ratio, size] of [
    ["lod0", lod0, 512],
    ["lod1", lod1, 256],
  ]) {
    const work = join(CACHE, `${name}-${lod}.glb`);
    const target = join(OUT, "models", `${name}-${lod}.glb`);
    gltf("weld", entry, work);
    gltf("simplify", work, work, "--ratio", String(ratio), "--error", "0.05");
    gltf("resize", work, work, "--width", String(size), "--height", String(size));
    gltf("prune", work, work);
    gltf("dedup", work, work);

    const document = await io.read(work);
    const material = document.getRoot().listMaterials()[0];
    if (lod === "lod0") {
      // One set of maps per rock, shared by both levels (same UVs).
      for (const [slot, texture] of [
        ["color", material.getBaseColorTexture()],
        ["normal", material.getNormalTexture()],
        ["orm", material.getMetallicRoughnessTexture()],
      ]) {
        const file = join(OUT, "textures", `${name}_${slot}_${size}.jpg`);
        if (extract(texture, file)) {
          record(file, { source: listing.url, dimensions: `${size}x${size}` });
        }
      }
    }
    for (const texture of document.getRoot().listTextures()) texture.dispose();
    for (const each of document.getRoot().listMaterials()) each.dispose();
    await io.write(target, document);
    record(target, { source: listing.url, triangles: triangles(target), textures: "none (separate JPEG)" });
  }
}

for (const { slug, name, ratio, size, alpha } of PROPS) {
  const all = await files(slug);
  const listing = all.gltf["1k"].gltf;
  const base = join(CACHE, slug);
  const entry = join(base, `${slug}.gltf`);
  await download(listing.url, entry);
  for (const [path, include] of Object.entries(listing.include)) {
    await download(include.url, join(base, path));
  }
  const work = join(CACHE, `${name}.glb`);
  const target = join(OUT, "models", `${name}.glb`);
  gltf("weld", entry, work);
  if (ratio < 1) gltf("simplify", work, work, "--ratio", String(ratio), "--error", "0.01");
  gltf("resize", work, work, "--width", String(size), "--height", String(size));
  gltf("prune", work, work);
  gltf("dedup", work, work);

  const document = await io.read(work);
  for (const material of document.getRoot().listMaterials()) {
    const prefix = material.getName().replace(/[^A-Za-z0-9_-]/g, "_");
    for (const [slot, texture] of [
      ["color", material.getBaseColorTexture()],
      ["normal", material.getNormalTexture()],
      ["orm", material.getMetallicRoughnessTexture()],
    ]) {
      const file = join(OUT, "textures", `${prefix}_${slot}_${size}.jpg`);
      if (extract(texture, file)) {
        record(file, { source: listing.url, dimensions: `${size}x${size}` });
      }
    }
    if (alpha) {
      const url = all.Alpha["1k"].jpg.url;
      const cached = join(base, "alpha_1k.jpg");
      await download(url, cached);
      const file = join(OUT, "textures", `${prefix}_alpha_1k.jpg`);
      copyFileSync(cached, file);
      record(file, { source: url, dimensions: "1024x1024" });
    }
  }
  for (const texture of document.getRoot().listTextures()) texture.dispose();
  for (const extension of document.getRoot().listExtensionsUsed()) extension.dispose();
  await io.write(target, document);
  record(target, { source: listing.url, triangles: triangles(target), textures: "none (separate JPEG)" });
}

writeFileSync(
  join(ROOT, "assets/beach-manifest.json"),
  `${JSON.stringify({ generated_by: "scripts/build-beach-assets.mjs", files: manifest }, null, 2)}\n`,
);
const total = manifest.reduce((sum, file) => sum + file.bytes, 0);
console.log(`${manifest.length} files, ${(total / 1024 / 1024).toFixed(2)} MiB`);
