/**
 * Sand, from the dunes behind the plaza down under the sea.
 *
 * One mesh, displaced on the CPU from `terrainHeight` (so the walkable disc
 * is exactly the y=0 the movement code assumes), shaded by the standard PBR
 * material with three additions spliced in:
 *
 *   - two scanned sand textures at unrelated scales, recoloured to one
 *     palette, so neither tile repeats visibly;
 *   - wetness from the shared swash model: darker and glossier where the
 *     last wave reached, drying back as it drains;
 *   - under water, per-channel absorption along the view path and faint
 *     caustics in the shallows — the colour of the sea is the colour of the
 *     sand seen through it.
 */
import * as THREE from "three";

import { FLAT_RADIUS, terrainHeight } from "./coast";
import { COAST_GLSL, WATER_SCATTER, type CoastUniforms } from "./coastShader";
import { placeholderTexture, type BeachAssets } from "./assets";
import type { QualityProfile } from "../rendering/quality";

/** Linear-space dry sand albedo the scans are recoloured toward. */
const DRY_SAND = new THREE.Color("#e4c897");
/** Per-metre absorption of red, green, blue in clear tropical water. */
const ABSORPTION = new THREE.Vector3(0.5, 0.16, 0.11);

function terrainGeometry(segments: number): THREE.BufferGeometry {
  const radii: number[] = [];
  // Coarse over the flat plaza (only the shading varies there), fine across
  // the beach and shelf where the waterline is, then outward geometrically.
  for (let r = 0; r < FLAT_RADIUS; r += 2) radii.push(r);
  let r = FLAT_RADIUS;
  let step = 0.45;
  while (r < 1400) {
    radii.push(r);
    r += step;
    if (r > 70) step *= 1.08;
  }
  radii.push(1400);
  const positions: number[] = [0, 0, 0];
  for (let ring = 1; ring < radii.length; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      const x = Math.sin(angle) * radii[ring];
      const z = -Math.cos(angle) * radii[ring];
      positions.push(x, terrainHeight(x, z), z);
    }
  }
  const indices: number[] = [];
  for (let segment = 0; segment < segments; segment += 1) {
    indices.push(0, 1 + ((segment + 1) % segments), 1 + segment);
  }
  for (let ring = 1; ring < radii.length - 1; ring += 1) {
    const inner = 1 + (ring - 1) * segments;
    const outer = inner + segments;
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      indices.push(inner + segment, inner + next, outer + segment);
      indices.push(inner + next, outer + next, outer + segment);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1400);
  return geometry;
}

const VERTEX_PARS = /* glsl */ `
varying vec3 vBeachWorld;
varying vec3 vBeachNormal;
`;

const VERTEX_MAIN = /* glsl */ `
#include <worldpos_vertex>
vBeachWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vBeachNormal = normalize(mat3(modelMatrix) * objectNormal);
`;

const FRAGMENT_PARS = /* glsl */ `
${COAST_GLSL}
uniform sampler2D uSandColor;
uniform sampler2D uSandNormal;
uniform sampler2D uSandArm;
uniform sampler2D uDuneColor;
uniform sampler2D uDuneNormal;
uniform vec3 uDrySand;
uniform vec3 uAbsorption;
uniform vec3 uWaterScatter;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
varying vec3 vBeachWorld;
varying vec3 vBeachNormal;

float beachWet;
vec4 beachArm;
bool beachUnderwater = false;

float caustic(vec2 p, float t) {
  vec2 q = p + 0.4 * vec2(sin(p.y * 1.7 + t * 0.9), sin(p.x * 1.9 - t * 0.8));
  float a = sin(q.x * 2.3 + t * 0.7) * sin(q.y * 2.1 - t * 0.6);
  vec2 r = p * 1.37 + 0.35 * vec2(sin(p.y * 2.3 - t * 0.7), sin(p.x * 2.1 + t * 0.5));
  float b = sin(r.x * 2.0 - t * 0.5) * sin(r.y * 2.4 + t * 0.8);
  return pow(clamp(1.0 - abs(a + b) * 0.9, 0.0, 1.0), 7.0);
}
`;

const FRAGMENT_COLOR = /* glsl */ `
vec2 beachXZ = vBeachWorld.xz;
vec2 rotated = mat2(0.6, -0.8, 0.8, 0.6) * beachXZ;
vec3 near = texture2D(uSandColor, beachXZ / 2.3).rgb;
vec3 nearAlt = texture2D(uSandColor, rotated / 5.3 + 0.37).rgb;
vec3 wide = texture2D(uDuneColor, beachXZ / 31.0).rgb;
float nearLum = dot(mix(near, nearAlt, 0.4), vec3(0.2126, 0.7152, 0.0722));
float wideLum = dot(wide, vec3(0.2126, 0.7152, 0.0722));
// Recolour by luminance ratio: the scans contribute structure, the palette
// is ours. 0.122 and 0.244 are the scans' measured mean linear luminances;
// the near scan is low-contrast, so its grain is amplified.
vec3 sand = uDrySand * clamp(1.0 + (nearLum / 0.122 - 1.0) * 1.8, 0.45, 1.6) * clamp(1.0 + (wideLum / 0.244 - 1.0) * 1.2, 0.6, 1.4);
sand = mix(sand, sand * normalize(near + 0.05) * 1.732, 0.18);
beachArm = texture2D(uSandArm, beachXZ / 2.3);

float aboveSea = vBeachWorld.y - SEA_LEVEL;
beachWet = sandWetness(aboveSea, beachXZ.x) * (1.0 - smoothstep(0.5, 1.2, aboveSea));
// Wet sand darkens and saturates: water fills the gaps between grains.
sand = mix(sand, sand * sand * 0.82, beachWet);
diffuseColor.rgb *= sand * mix(1.0, beachArm.r, 0.45);
`;

const FRAGMENT_ROUGHNESS = /* glsl */ `
float roughnessFactor = mix(clamp(beachArm.g * 1.1, 0.6, 1.0), 0.16, beachWet);
`;

const FRAGMENT_NORMAL = /* glsl */ `
{
  float plaza = 1.0 - smoothstep(12.0, 20.0, length(beachXZ));
  vec3 detail = texture2D(uSandNormal, beachXZ / 2.3).xyz * 2.0 - 1.0;
  vec3 ripples = texture2D(uDuneNormal, beachXZ / 31.0).xyz * 2.0 - 1.0;
  float ripplesStrength = mix(0.6, 0.18, plaza) * (1.0 - beachWet * 0.6);
  vec3 tangentNormal = normalize(vec3(detail.xy * mix(0.85, 1.1, plaza) * (1.0 - beachWet * 0.5) + ripples.xy * ripplesStrength, detail.z * ripples.z));
  vec3 baseNormal = normalize(vBeachNormal);
  vec3 tangent = normalize(vec3(1.0, 0.0, 0.0) - baseNormal * baseNormal.x);
  vec3 bitangent = cross(tangent, baseNormal);
  vec3 worldNormal = normalize(tangent * tangentNormal.x + bitangent * tangentNormal.y + baseNormal * tangentNormal.z);
  normal = normalize((viewMatrix * vec4(worldNormal, 0.0)).xyz);
}
`;

const FRAGMENT_UNDERWATER = /* glsl */ `
{
  vec4 coastHere = coastAt(beachXZ);
  float surface = shoreWaterLevel(beachXZ.x, coastHere.y);
  float waterDepth = surface - vBeachWorld.y;
  if (waterDepth > 0.0) {
    beachUnderwater = true;
    vec3 toEye = normalize(cameraPosition - vBeachWorld);
    // Sunlight down to the sand and back up toward the eye.
    float path = waterDepth + waterDepth / max(toEye.y, 0.12);
    vec3 transmitted = exp(-uAbsorption * path);
    float shallow = exp(-waterDepth * 0.9) * smoothstep(0.03, 0.3, waterDepth);
    vec3 caustics = uSunColor * caustic(beachXZ * 0.9, uTime * 0.9) * shallow * 0.05 * max(uSunDirection.y, 0.0);
    gl_FragColor.rgb = (gl_FragColor.rgb + caustics) * transmitted + uWaterScatter * (1.0 - transmitted);
  }
}
`;

export interface Terrain {
  mesh: THREE.Mesh;
  resources: { dispose(): void }[];
  /** Swap in the scanned textures as they arrive; placeholders until then. */
  load(assets: BeachAssets): Promise<void>;
}

export function createTerrain(
  coast: CoastUniforms,
  sky: { uSunDirection: { value: THREE.Vector3 }; uSunColor: { value: THREE.Color } },
  quality: QualityProfile,
): Terrain {
  const placeholders = {
    color: placeholderTexture([200, 200, 200, 255], THREE.SRGBColorSpace),
    normal: placeholderTexture([128, 128, 255, 255], THREE.NoColorSpace),
    arm: placeholderTexture([255, 235, 0, 255], THREE.NoColorSpace),
  };
  const uniforms = {
    uSandColor: { value: placeholders.color as THREE.Texture },
    uSandNormal: { value: placeholders.normal as THREE.Texture },
    uSandArm: { value: placeholders.arm as THREE.Texture },
    uDuneColor: { value: placeholders.color as THREE.Texture },
    uDuneNormal: { value: placeholders.normal as THREE.Texture },
    uDrySand: { value: DRY_SAND },
    uAbsorption: { value: ABSORPTION },
    uWaterScatter: { value: WATER_SCATTER },
  };
  const material = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, coast, uniforms, {
      uSunDirection: sky.uSunDirection,
      uSunColor: sky.uSunColor,
    });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERTEX_PARS}`)
      .replace("#include <worldpos_vertex>", VERTEX_MAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAGMENT_PARS}`)
      .replace("#include <map_fragment>", FRAGMENT_COLOR)
      .replace("#include <roughnessmap_fragment>", FRAGMENT_ROUGHNESS)
      .replace("#include <normal_fragment_maps>", FRAGMENT_NORMAL)
      .replace("#include <opaque_fragment>", `#include <opaque_fragment>\n${FRAGMENT_UNDERWATER}`)
      // Under water the sea surface carries the haze (it is drawn over this
      // with its own, clearer sea air); land haze here would show through it
      // as a pale band.
      .replace("#include <fog_fragment>", "if (!beachUnderwater) {\n#include <fog_fragment>\n}");
  };
  material.customProgramCacheKey = () => "plaza-beach-terrain";

  const mesh = new THREE.Mesh(
    terrainGeometry(quality.level === "high" ? 360 : 200),
    material,
  );
  mesh.name = "terrain";
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  const loaded: THREE.Texture[] = [];
  return {
    mesh,
    resources: [...Object.values(placeholders), { dispose: () => loaded.forEach((t) => t.dispose()) }],
    async load(assets) {
      const wanted: [keyof typeof uniforms, string, THREE.ColorSpace][] = [
        ["uSandColor", "sand_03_diff_1k.jpg", THREE.SRGBColorSpace],
        ["uSandNormal", "sand_03_nor_1k.jpg", THREE.NoColorSpace],
        ["uSandArm", "sand_03_arm_1k.jpg", THREE.NoColorSpace],
        ["uDuneColor", "aerial_beach_01_diff_1k.jpg", THREE.SRGBColorSpace],
        ["uDuneNormal", "aerial_beach_01_nor_1k.jpg", THREE.NoColorSpace],
      ];
      await Promise.all(
        wanted.map(async ([uniform, name, colorSpace]) => {
          try {
            const texture = await assets.texture(name, colorSpace);
            loaded.push(texture);
            (uniforms[uniform] as { value: THREE.Texture }).value = texture;
          } catch (error) {
            // One missing texture leaves its placeholder; the beach still works.
            if ((error as Error).message !== "load_aborted") {
              console.warn(`[plaza] beach texture unavailable: ${name}`);
            }
          }
        }),
      );
    },
  };
}
