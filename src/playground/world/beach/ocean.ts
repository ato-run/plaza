/**
 * The sea surface: swell, wind ripples, reflection, sun glitter and surf foam.
 *
 * What it deliberately does NOT do is colour the water body. Absorption
 * depends on how much water lies between the eye and the sand, per colour
 * channel, and a single blended surface cannot express "red gone, blue left";
 * so the seabed shader (`terrain.ts`) tints what lies under the surface, and
 * this surface adds only what the surface itself contributes — Fresnel
 * reflection of the shared sky, the sun's highlight and foam — as
 * premultiplied colour over it.
 *
 * Waves are Gerstner sums evaluated on the GPU. They are the open-sea swell
 * only: in the shallows they die away and the surf comes from the shore
 * model in `coastShader.ts` — a bore travelling in, then the swash — which is
 * also what wets the sand.
 */
import * as THREE from "three";

import { COAST_GLSL, WATER_SCATTER, type CoastUniforms } from "./coastShader";
import { SKY_GLSL } from "../rendering/skyShader";
import type { QualityProfile } from "../rendering/quality";
import type { WorldLighting } from "../types";

/** Swell components: wavelength (m), amplitude (m), heading from +Z (deg), phase. */
const SWELL: ReadonlyArray<readonly [number, number, number, number]> = [
  [34, 0.15, -10, 0.0],
  [21, 0.1, 17, 1.7],
  [13.5, 0.06, -32, 4.1],
  [8.2, 0.035, 38, 2.6],
  [5.1, 0.02, 4, 5.3],
];

/** Wind ripples: a tileable normal map baked once, sampled at two scales. */
export function rippleTexture(size = 256): THREE.DataTexture {
  // Sum of waves with integer frequencies wraps exactly at the tile edge.
  const waves: [number, number, number, number][] = [];
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 48; i += 1) {
    const kx = Math.round((random() * 2 - 1) * (3 + i * 0.6));
    const ky = Math.round((random() * 2 - 1) * (3 + i * 0.6));
    if (kx === 0 && ky === 0) continue;
    const k = Math.hypot(kx, ky);
    waves.push([kx, ky, 1 / Math.pow(k, 1.35), random() * Math.PI * 2]);
  }
  const data = new Uint8Array(size * size * 4);
  const tau = Math.PI * 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      let dx = 0;
      let dy = 0;
      let foam = 0;
      for (const [kx, ky, amplitude, phase] of waves) {
        const c = Math.cos(tau * (kx * u + ky * v) + phase) * amplitude * tau;
        dx += kx * c;
        dy += ky * c;
        foam += Math.sin(tau * (kx * u * 1 + ky * v) + phase * 1.7) * amplitude;
      }
      const index = (y * size + x) * 4;
      data[index] = Math.max(0, Math.min(255, 128 + dx * 2.2));
      data[index + 1] = Math.max(0, Math.min(255, 128 + dy * 2.2));
      data[index + 2] = 255;
      // Alpha: a lacy scalar field that breaks foam into patches.
      data[index + 3] = Math.max(0, Math.min(255, 128 + foam * 160));
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * A disc of rings, fine where people can see the waterline and growing
 * geometrically toward the horizon. Static: the camera never leaves the
 * plaza, so there is nothing to follow.
 */
function oceanGeometry(segments: number, nearSpacing: number): THREE.BufferGeometry {
  const radii: number[] = [0];
  let r = 0;
  let step = nearSpacing;
  while (r < 1400) {
    r += step;
    radii.push(r);
    if (r > 64) step *= 1.07;
  }
  const positions: number[] = [0, 0, 0];
  for (let ring = 1; ring < radii.length; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      positions.push(Math.sin(angle) * radii[ring], 0, -Math.cos(angle) * radii[ring]);
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
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1400);
  return geometry;
}

const SWELL_GLSL = /* glsl */ `
#define WAVE_COUNT ${SWELL.length}
uniform vec4 uSwell[WAVE_COUNT];   // xy: unit direction, z: wavenumber, w: amplitude
uniform float uSwellPhase[WAVE_COUNT];

// Gerstner swell at a rest position. \`reach\` scales how far out short waves
// survive: the vertex stage drops them sooner than the per-pixel normal.
void swellAt(vec2 xz, float shoal, float distanceToEye, float reach, out vec3 offset, out vec3 normal) {
  offset = vec3(0.0);
  normal = vec3(0.0, 1.0, 0.0);
  for (int i = 0; i < WAVE_COUNT; i++) {
    vec4 wave = uSwell[i];
    float k = wave.z;
    float wavelength = 6.2831853 / k;
    float fade = 1.0 - smoothstep(wavelength * 6.0 * reach, wavelength * 18.0 * reach, distanceToEye);
    float amplitude = wave.w * shoal * fade;
    float omega = sqrt(9.81 * k);
    float theta = k * dot(wave.xy, xz) - omega * uTime + uSwellPhase[i];
    float steep = 0.55 / (k * 0.15 * float(WAVE_COUNT));
    float c = cos(theta);
    float s = sin(theta);
    offset.xz += steep * amplitude * wave.xy * c;
    offset.y += amplitude * s;
    normal.xz -= wave.xy * k * amplitude * c;
    normal.y -= steep * k * amplitude * s;
  }
}

// The surf model's height and slope (along the landward direction).
vec2 surfAt(vec4 coast, float along) {
  vec2 bore = boreState(along, coast.y);
  float d = bore.x;
  float width = d > 0.0 ? 0.8 : 2.8;   // steep face toward the beach
  // Builds over the shelf, collapses into the run-up at the sand.
  float growth = smoothstep(-BORE_TRAVEL, -BORE_TRAVEL * 0.4, coast.y) * (1.0 - smoothstep(-2.0, 0.0, coast.y));
  float height = bore.y * 0.55 * growth * exp(-(d * d) / (width * width)) * step(coast.y, 1.0);
  return vec2(height, -2.0 * d / (width * width) * height);
}
`;

const VERTEX = /* glsl */ `
${COAST_GLSL}
${SWELL_GLSL}
varying vec3 vWorld;
varying vec2 vRest;
#include <fog_pars_vertex>

void main() {
  vec2 xz = position.xz;
  vec4 coast = coastAt(xz);
  // Open swell dies in the shallows; the shore model takes over there.
  float shoal = smoothstep(0.4, 6.0, SEA_LEVEL - coast.x);
  vec3 offset;
  vec3 unusedNormal;
  swellAt(xz, shoal, length(xz - cameraPosition.xz), 1.0, offset, unusedNormal);
  // Surf: a bore rolling in over the shelf, then the run-up near the sand.
  vec2 surf = surfAt(coast, xz.x);
  offset.y += surf.x + (shoreWaterLevel(xz.x, coast.y) - SEA_LEVEL);

  vec3 world = vec3(xz.x + offset.x, SEA_LEVEL + offset.y, xz.y + offset.z);
  vWorld = world;
  vRest = xz;
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
#define ENVMAP_TYPE_CUBE_UV
${COAST_GLSL}
${SWELL_GLSL}
${SKY_GLSL}
uniform sampler2D uRipples;
uniform sampler2D envMap;
uniform float uEnvIntensity;
uniform float uRippleStrength;
uniform vec3 uWaterScatter;
varying vec3 vWorld;
varying vec2 vRest;
#include <common>
#include <cube_uv_reflection_fragment>
#include <fog_pars_fragment>

void main() {
  vec4 coast = coastAt(vWorld.xz);
  float depth = vWorld.y - coast.x;
  if (depth <= 0.0) discard;
  vec3 toEye = cameraPosition - vWorld;
  float distanceToEye = length(toEye);
  vec3 view = toEye / distanceToEye;

  // Normals per pixel, not interpolated from the ring mesh: interpolation
  // across its long outer triangles shows up as spokes on the water.
  vec4 restCoast = coastAt(vRest);
  vec3 swellOffset;
  vec3 swellNormal;
  swellAt(vRest, smoothstep(0.4, 6.0, SEA_LEVEL - restCoast.x), distanceToEye, 2.0, swellOffset, swellNormal);
  vec2 surf = surfAt(restCoast, vRest.x);
  swellNormal.xz -= restCoast.zw * surf.y;
  vec2 bore = boreState(vRest.x, restCoast.y);

  // Two ripple layers drifting with the wind, weaker with distance so the
  // horizon does not shimmer.
  vec2 drift = vec2(0.012, 0.03) * uTime;
  vec4 r1 = texture2D(uRipples, vWorld.xz / 9.0 + drift);
  vec4 r2 = texture2D(uRipples, mat2(0.8, -0.6, 0.6, 0.8) * vWorld.xz / 3.7 - drift * 1.7);
  float rippleFade = uRippleStrength * (1.0 - smoothstep(25.0, 260.0, distanceToEye));
  // Calm right at the water's edge, where a thin film cannot carry chop.
  rippleFade *= smoothstep(0.02, 0.35, depth);
  vec2 slope = ((r1.xy - 0.5) + (r2.xy - 0.5) * 0.7) * rippleFade;
  // Unresolved chop far away still tilts the average facet toward the eye
  // (the slopes facing away are hidden behind their own crests), so distant
  // water reflects higher, bluer sky instead of going mirror-white.
  vec2 facing = normalize(view.xz + 1e-4) * 0.2 * smoothstep(3.0, 70.0, distanceToEye);
  vec3 normal = normalize(normalize(swellNormal) + vec3(slope.x + facing.x, 0.0, slope.y + facing.y));

  float nDotV = max(dot(normal, view), 0.0);
  // Schlick, scaled for the light that rough facets shadow and mask.
  float fresnel = (0.02 + 0.98 * pow(1.0 - nDotV, 5.0)) * 0.78;
  vec3 reflected = reflect(-view, normal);
  reflected.y = max(reflected.y, 0.015);
  reflected = normalize(reflected);
  float blur = 0.06 + 0.2 * smoothstep(40.0, 400.0, distanceToEye);
  vec3 sky = textureCubeUV(envMap, reflected, blur).rgb * uEnvIntensity;

  // Sun: a tight glint plus a broader sheen, the sun's own colour.
  vec3 halfway = normalize(view + uSunDirection);
  float nh = max(dot(normal, halfway), 0.0);
  vec3 sun = uSunColor * (pow(nh, 1400.0) * 9.0 + pow(nh, 120.0) * 0.25) * fresnel * 6.0;

  vec3 color = sky * fresnel + sun;
  float alpha = fresnel;

  // Foam: the leading edge of the run-up, the face of the breaking bore,
  // and the lace it leaves behind, broken up so no two stretches match.
  float lace = r1.a * 0.6 + texture2D(uRipples, vWorld.xz / 2.3 + drift * 0.4).a * 0.6;
  float fine = texture2D(uRipples, vec2(vWorld.x / 1.3, vWorld.z / 0.9) - drift * 2.0).a;
  float edge = (1.0 - smoothstep(0.0, 0.03 + 0.04 * lace, depth)) * step(-4.0, restCoast.y);
  // Only stretches of the crest that are actually spilling carry white water,
  // and only once the wave has reached the shallows.
  float spilling = smoothstep(0.35, 0.7, texture2D(uRipples, vec2(vRest.x / 23.0 + uTime * 0.01, 0.37)).a)
    * smoothstep(-9.0, -5.0, restCoast.y);
  float crest = surf.x > 0.0 ? smoothstep(0.02, 0.12, surf.x) * exp(-pow((bore.x - 0.25) / 0.6, 2.0)) * spilling : 0.0;
  float wake = bore.x < 0.0 ? exp(bore.x / 4.0) * smoothstep(-BORE_TRAVEL * 0.8, -3.0, restCoast.y) * step(restCoast.y, 0.5) : 0.0;
  // The crest is dense white water; the wake behind it thins into lace.
  float dense = clamp(edge * 0.95 + crest * 1.3, 0.0, 1.0);
  float foam = max(dense * smoothstep(0.3, 0.6, fine * 0.6 + lace * 0.3 + dense * 0.3), wake * 0.7 * smoothstep(0.55, 0.85, lace));
  // Foam is a rough white diffuser: direct sun plus the sky's average.
  vec3 foamLight = 1.15 * (uSunColor * max(uSunDirection.y, 0.0) / PI + (uHorizon + uZenith) * 0.5);
  color = mix(color, foamLight, foam);
  alpha = mix(alpha, 1.0, foam);

  // Over deep water nothing of the seabed survives the long slant path the
  // eye looks along from the beach, so the surface takes the deep-water
  // colour itself. It must: a ray through the surface 120m out would only
  // reach the seabed past the far plane, and show the dome below instead.
  float body = smoothstep(4.0, 9.0, depth);
  color += (1.0 - alpha) * body * uWaterScatter;
  alpha = mix(alpha, 1.0, body);

  // Soft waterline instead of a hard intersection with the sand.
  float film = smoothstep(0.0, 0.025, depth);
  color *= film;
  alpha *= film;

  #ifdef USE_FOG
    #ifdef FOG_EXP2
      // Sea air is clearer than the haze that hides the land's far edge.
      float seaFog = fogDensity * 0.35;
      float fogFactor = 1.0 - exp(-seaFog * seaFog * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    // Far water fades to the sky it reflects — a little above the horizon,
    // through the average tilted facet — so the sea meets the sky as a soft
    // darker line rather than dissolving into the haze band.
    vec3 haze = skyRadiance(normalize(vec3(-view.x, 0.3, -view.z))) * 0.7;
    color = mix(color, haze, fogFactor);
    alpha = mix(alpha, 1.0, fogFactor);
  #endif

  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface Ocean {
  mesh: THREE.Mesh;
  /** Resources the scene walk cannot see (uniform textures). */
  resources: { dispose(): void }[];
}

export function createOcean(
  coast: CoastUniforms,
  lighting: WorldLighting,
  quality: QualityProfile,
): Ocean {
  const ripples = rippleTexture();
  const height = Math.max(lighting.environmentHeight, 64);
  const maxMip = Math.log2(height) - 2;
  const material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    defines: {
      CUBEUV_TEXEL_WIDTH: 1 / (3 * Math.max(Math.pow(2, maxMip), 7 * 16)),
      CUBEUV_TEXEL_HEIGHT: 1 / height,
      CUBEUV_MAX_MIP: `${maxMip}.0`,
    },
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    fog: true,
  });
  // Shared uniform objects, not copies: the clock, the sky and the
  // environment map change in one place and every surface sees it.
  Object.assign(material.uniforms, coast, lighting.sky, {
    envMap: lighting.environment,
    uEnvIntensity: { value: 1 },
    uRipples: { value: ripples },
    uRippleStrength: { value: 0.55 },
    uWaterScatter: { value: WATER_SCATTER },
    uSwell: {
      value: SWELL.map(([wavelength, amplitude, heading]) => {
        const radians = (heading * Math.PI) / 180;
        return new THREE.Vector4(
          Math.sin(radians),
          Math.cos(radians),
          (Math.PI * 2) / wavelength,
          amplitude,
        );
      }),
    },
    uSwellPhase: { value: SWELL.map(([, , , phase]) => phase) },
  });
  const mesh = new THREE.Mesh(
    oceanGeometry(quality.oceanSegments, quality.level === "high" ? 0.3 : 0.55),
    material,
  );
  mesh.name = "ocean";
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return { mesh, resources: [ripples] };
}
