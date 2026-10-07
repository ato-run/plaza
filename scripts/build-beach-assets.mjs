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
 * Mesh reduction uses `@gltf-transform/cli` through `npx`, pinned below,
 * rather than a devDependency: `npm ci` runs inside the capsule build, and
 * its native image dependency has no business there.
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
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, "assets/source/cache");
const OUT = join(ROOT, "public/assets/beach");
const GLTF_TRANSFORM = "@gltf-transform/cli@4.2.1";
const POLY_HAVEN = "https://api.polyhaven.com/files";

/** Ground textures: Poly Haven slug → maps → distributed name. 1K JPEG as published. */
const TEXTURES = [
  { slug: "sand_03", maps: { Diffuse: "diff", nor_gl: "nor", arm: "arm" } },
  { slug: "aerial_beach_01", maps: { Diffuse: "diff", nor_gl: "nor" } },
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
    gltf("dedup", work, target);
    record(target, {
      source: listing.url,
      triangles: triangles(target),
      texture_size: `${size}x${size}`,
    });
  }
}

writeFileSync(
  join(ROOT, "assets/beach-manifest.json"),
  `${JSON.stringify({ generated_by: "scripts/build-beach-assets.mjs", files: manifest }, null, 2)}\n`,
);
const total = manifest.reduce((sum, file) => sum + file.bytes, 0);
console.log(`${manifest.length} files, ${(total / 1024 / 1024).toFixed(2)} MiB`);
