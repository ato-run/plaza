/**
 * The sky as a function, shared by everything that has to agree with it.
 *
 * The visible dome, the image-based lighting baked from it, the colour the
 * ocean fades into at the horizon and the haze over distant land all call
 * `skyRadiance` with the same uniforms. A horizon seam — water that fades to
 * one blue under a sky of another — is the first thing that gives a rendered
 * sea away, and two hand-tuned colours drift apart the moment one changes.
 */
import * as THREE from "three";

/** Uniforms for `SKY_GLSL`. Colours are linear working-space RGB. */
export interface SkyUniforms {
  uSunDirection: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  uZenith: { value: THREE.Color };
  uHorizon: { value: THREE.Color };
  uGround: { value: THREE.Color };
}

export const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;

// Sky radiance seen along a unit direction, without the sun's disc.
vec3 skyRadiance(vec3 dir) {
  float up = clamp(dir.y, 0.0, 1.0);
  // With the sun low, the horizon away from it cools toward the zenith hue
  // (the pink-violet band opposite a sunset); at midday this all but vanishes.
  vec2 flatDir = normalize(dir.xz + 1e-5);
  vec2 flatSun = normalize(uSunDirection.xz + 1e-5);
  float toward = 0.5 + 0.5 * dot(flatDir, flatSun);
  float lowSun = 1.0 - smoothstep(0.08, 0.5, uSunDirection.y);
  vec3 horizon = mix(mix(uHorizon, uZenith * 1.6, 0.45), uHorizon, mix(1.0, toward, lowSun * 0.85));
  vec3 daySky = mix(horizon, uZenith, pow(up, 0.45));
  // A low sun's sky does not blend gold straight into blue (that reads as
  // mauve): the gold band gives way to pale blue, then deepens overhead.
  vec3 paleBlue = uZenith * 2.4 + vec3(0.06, 0.08, 0.1);
  vec3 upper = mix(paleBlue, uZenith, smoothstep(0.2, 0.85, up));
  vec3 duskSky = mix(horizon, upper, smoothstep(0.0, 0.45, pow(up, 0.7)));
  vec3 sky = mix(daySky, duskSky, lowSun);
  // A brighter band of haze sits on the horizon in a clear tropical sky.
  sky += horizon * 0.12 * exp(-up * 16.0);
  float mu = max(dot(dir, uSunDirection), 0.0);
  // Forward scattering around the sun: a wide halo and a tight glow.
  sky += uSunColor * (0.035 * pow(mu, 3.0) + 0.16 * pow(mu, 48.0));
  // A sun near the horizon shines through far more air: a wide warm glow.
  sky += uSunColor * lowSun * (0.12 * pow(mu, 10.0) + 0.5 * pow(mu, 180.0));
  // Below the horizon only the lighting and the fog ever look: haze over sand.
  float down = clamp(-dir.y, 0.0, 1.0);
  return mix(sky, uGround, smoothstep(0.0, 0.3, down));
}

`;

const DOME_VERTEX = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 clip = projectionMatrix * viewMatrix * vec4((modelMatrix * vec4(position, 1.0)).xyz, 1.0);
  // Pin the dome to the far plane so it never occludes anything.
  gl_Position = clip.xyww;
}
`;

const DOME_FRAGMENT = /* glsl */ `
${SKY_GLSL}
uniform float uSunDisc;
uniform float uClouds;
varying vec3 vDirection;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float sum = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 5; i++) {
    sum += amplitude * noise(p);
    p = p * 2.03 + vec2(17.0, 9.0);
    amplitude *= 0.5;
  }
  return sum;
}

void main() {
  vec3 dir = normalize(vDirection);
  vec3 color = skyRadiance(dir);
  if (uClouds > 0.0 && dir.y > 0.0) {
    // Fair-weather cumulus on a flat layer: thin near the zenith, bunched
    // toward the horizon by the projection, lit from the sun's side.
    vec2 layer = dir.xz / (dir.y + 0.08) * 1.4;
    float density = smoothstep(0.52, 0.78, fbm(layer + vec2(3.1, 7.7)));
    density *= smoothstep(0.0, 0.12, dir.y) * uClouds;
    // Lit by the sun's own colour (white at noon, orange at dusk) over the
    // sky's ambient, brightest toward the sun.
    float mu = max(dot(dir, uSunDirection), 0.0);
    vec3 cloud = (uZenith * 0.35 + uHorizon * 0.55) + uSunColor * (0.1 + 0.18 * mu * mu);
    color = mix(color, cloud, density * 0.85);
  }
  float sunAngle = dot(dir, uSunDirection);
  // The disc itself, HDR so tone mapping rolls it off rather than clipping.
  color += uSunColor * uSunDisc * smoothstep(0.99985, 0.99993, sunAngle);
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createSkyUniforms(): SkyUniforms {
  return {
    uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uGround: { value: new THREE.Color() },
  };
}

/**
 * The visible dome. `sunDisc` is 0 for the copy baked into the environment
 * map: a 1500-nit pinpoint in the IBL would double the sun the directional
 * light already provides, as sparkle on every glossy surface.
 */
export function createSkyDome(
  uniforms: SkyUniforms,
  options: { sunDisc: number; clouds: number },
): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      uSunDisc: { value: options.sunDisc },
      uClouds: { value: options.clouds },
    },
    vertexShader: DOME_VERTEX,
    fragmentShader: DOME_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), material);
  dome.scale.setScalar(500);
  dome.frustumCulled = false;
  dome.renderOrder = -1;
  dome.name = "sky";
  return dome;
}
