/**
 * The coast, on the GPU.
 *
 * `coast.ts` is the definition; this module carries it to shaders as one baked
 * texture plus the swash model, and every surface that meets the waterline —
 * the ocean, its foam, the wet sand, the seabed tint — includes the same
 * GLSL. The swash (how far up the beach each wave runs, and when) is a pure
 * function of time and position along the shore, so the water's edge, the
 * foam at its tip and the dark band it leaves behind cannot drift apart.
 */
import * as THREE from "three";

import { bakeCoastField, SEA_LEVEL } from "./coast";

/** Seconds between sets reaching any one stretch of beach. */
export const SWASH_PERIOD = 9;

/**
 * Light scattered back out of deep water (linear radiance). The seabed shader
 * fades to it with depth; the ocean uses it directly where the seabed is
 * beyond the far plane.
 */
export const WATER_SCATTER = new THREE.Color().setRGB(0.004, 0.038, 0.085);

export interface CoastUniforms {
  uCoastField: { value: THREE.DataTexture };
  uCoastExtent: { value: number };
  /** World clock in seconds; the only clock the water and sand read. */
  uTime: { value: number };
}

export function createCoastUniforms(size: number): CoastUniforms {
  const field = bakeCoastField(size, 240);
  const half = new Uint16Array(field.data.length);
  for (let i = 0; i < field.data.length; i += 1) {
    half[i] = THREE.DataUtils.toHalfFloat(field.data[i]);
  }
  const texture = new THREE.DataTexture(
    half,
    field.size,
    field.size,
    THREE.RGBAFormat,
    THREE.HalfFloatType,
  );
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return {
    uCoastField: { value: texture },
    uCoastExtent: { value: field.extent },
    uTime: { value: 0 },
  };
}

export const COAST_GLSL = /* glsl */ `
uniform sampler2D uCoastField;
uniform float uCoastExtent;
uniform float uTime;

#define SEA_LEVEL ${SEA_LEVEL.toFixed(3)}
#define SWASH_PERIOD ${SWASH_PERIOD.toFixed(1)}
#define SWASH_RISE 0.3
#define BORE_TRAVEL 15.0
#define PI_C 3.14159265

// x: ground height, y: signed distance to the waterline (+ land),
// zw: unit direction toward land. Open ocean beyond the baked area.
vec4 coastAt(vec2 xz) {
  vec2 uv = xz / uCoastExtent + 0.5;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
    return vec4(-22.0, -300.0, 0.0, 1.0);
  }
  return texture2D(uCoastField, uv);
}

float coastHash(float n) {
  return fract(sin(n * 91.345) * 47453.21);
}

// Cycles elapsed at an along-shore position: sets reach different stretches
// of the beach at different moments, never the whole coast at once.
float swashCycles(float s) {
  return uTime / SWASH_PERIOD + 0.55 * sin(s * 0.043 + 1.0) + 0.3 * sin(s * 0.117 + 2.3);
}

// How high (metres above calm sea) cycle n runs up at s. Every set differs.
float swashAmplitude(float n, float s) {
  float segment = s / 14.0;
  float i = floor(segment);
  float f = smoothstep(0.0, 1.0, fract(segment));
  float a = mix(coastHash(n * 7.13 + i), coastHash(n * 7.13 + i + 1.0), f);
  return 0.17 + 0.2 * a;
}

// 0 → 1 → 0 over one cycle: a quick run-up, a slower draining backwash.
float swashShape(float phase) {
  return phase < SWASH_RISE
    ? sin(phase / SWASH_RISE * 1.5707963)
    : 0.5 + 0.5 * cos((phase - SWASH_RISE) / (1.0 - SWASH_RISE) * PI_C);
}

// Current run-up height at s.
float swashHeight(float s) {
  float c = swashCycles(s);
  float n = floor(c);
  return swashAmplitude(n, s) * swashShape(c - n);
}

// Where the water surface stands at the shore, given the signed distance.
float shoreWaterLevel(float s, float distance) {
  return SEA_LEVEL + swashHeight(s) * smoothstep(-10.0, -1.0, distance);
}

// The phase at which water at height h above calm sea drained on cycle n.
float drainPhase(float h, float amplitude) {
  float x = clamp(2.0 * h / amplitude - 1.0, -1.0, 1.0);
  return SWASH_RISE + (1.0 - SWASH_RISE) * acos(x) / PI_C;
}

// Sand wetness at height h above calm sea: 1 while covered, then drying for
// as long as it has been uncovered. The previous set's mark keeps drying
// while the next one runs up, so the dark band never snaps.
float sandWetness(float h, float s) {
  if (h <= 0.0) return 1.0;
  float c = swashCycles(s);
  float n = floor(c);
  float phase = c - n;
  float amplitude = swashAmplitude(n, s);
  if (h <= amplitude * swashShape(phase)) return 1.0;
  float wet = 0.0;
  if (phase > SWASH_RISE && h < amplitude) {
    wet = exp(-(phase - drainPhase(h, amplitude)) * SWASH_PERIOD / 6.0);
  }
  float previous = swashAmplitude(n - 1.0, s);
  if (h < previous) {
    wet = max(wet, exp(-(phase + 1.0 - drainPhase(h, previous)) * SWASH_PERIOD / 6.0));
  }
  // Below the highest reach the sand never fully dries between sets.
  wet = max(wet, 0.35 * (1.0 - smoothstep(0.0, 0.4, h)));
  return wet;
}

// The breaking wave nearest this point: x = metres shoreward of its crest
// (negative behind it), y = the height of the set it belongs to.
//
// Crests are the lines where cycles-elapsed plus distance-in-travel-units is
// a whole number, so they run continuously along the coast (oblique where
// sets arrive late) and each one reaches the waterline exactly as its run-up
// begins. Amplitude switches between sets only at the trough, where the
// height is already zero.
vec2 boreState(float s, float distance) {
  float u = swashCycles(s) + distance / BORE_TRAVEL;
  float set = floor(u + 0.5);
  return vec2((u - set) * BORE_TRAVEL, swashAmplitude(set, s));
}
`;
