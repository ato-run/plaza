/**
 * Sky, sun, image-based light and haze for the mounted World.
 *
 * Owned by the engine, applied per World: `apply` sets everything up from a
 * `WorldEnvironment`, `clear` releases it before the next World is built.
 * The prefiltered environment map is rendered once per apply — never per
 * frame — because the sky does not move.
 */
import * as THREE from "three";

import type { WorldEnvironment, WorldLighting, WorldSky } from "../types";
import { createSkyDome, createSkyUniforms } from "./skyShader";

export interface EnvironmentController {
  /** Set up a World's environment, in the given time of day if it has one. */
  apply(
    environment: WorldEnvironment,
    timeOfDay?: string | null,
  ): WorldLighting;
  /**
   * Change the light of the mounted World in place: same uniforms, same
   * lighting handle, one re-bake. Materials that captured the sky follow.
   */
  retune(sky: WorldSky, rebake?: boolean): void;
  /** Release the current World's sky, environment map and fog. */
  clear(): void;
  /** Re-render GPU-only results after a lost context comes back. */
  restore(): void;
  dispose(): void;
}

/** Fixed rig used by Worlds without a sky (the pre-beach look). */
const LEGACY = {
  hemisphere: 2.5,
  sun: 3,
  sunPosition: new THREE.Vector3(-12, 22, 9),
  exposure: 1.2,
  far: 110,
};

export function createEnvironment(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  sun: THREE.DirectionalLight,
  hemisphere: THREE.HemisphereLight,
): EnvironmentController {
  let dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> | null =
    null;
  let target: THREE.WebGLRenderTarget | null = null;
  let current: WorldSky | null = null;
  const uniforms = createSkyUniforms();
  const environmentMap: { value: THREE.Texture | null } = { value: null };
  const direction = new THREE.Vector3();
  const haze = new THREE.Color();
  const fillColor = new THREE.Color();

  function bake(sky: WorldSky): void {
    target?.dispose();
    const envScene = new THREE.Scene();
    // Light from the sky without the disc (the directional light is the
    // sun); clouds kept faint so they soften rather than blotch reflections.
    const envDome = createSkyDome(uniforms, {
      sunDisc: 0,
      clouds: sky.clouds * 0.5,
    });
    envScene.add(envDome);
    const generator = new THREE.PMREMGenerator(renderer);
    target = generator.fromScene(envScene, 0, 0.1, 1000);
    generator.dispose();
    envDome.geometry.dispose();
    envDome.material.dispose();
    scene.environment = target.texture;
    environmentMap.value = target.texture;
  }

  function tune(sky: WorldSky, rebake = true): void {
    direction.set(...sky.sunDirection).normalize();
    uniforms.uSunDirection.value.copy(direction);
    uniforms.uSunColor.value.set(sky.sunColor).multiplyScalar(sky.sunIntensity);
    uniforms.uZenith.value.set(sky.zenith);
    uniforms.uHorizon.value.set(sky.horizon);
    uniforms.uGround.value.set(sky.ground);
    if (dome) {
      dome.material.uniforms.uClouds.value = sky.clouds;
      dome.material.uniforms.uSunDisc.value = sky.sunDisc ?? 40;
    }
    // Distant land fades into the horizon colour; water does its own haze
    // per azimuth from the same sky function.
    haze.copy(uniforms.uHorizon.value).multiplyScalar(1.12);
    if (scene.fog instanceof THREE.FogExp2) {
      scene.fog.color.copy(haze);
      scene.fog.density = sky.hazeDensity;
    } else scene.fog = new THREE.FogExp2(haze, sky.hazeDensity);
    if (rebake) bake(sky);
    scene.environmentIntensity = sky.environmentIntensity;
    // The IBL carries the sky's fill now; a fixed hemisphere on top of it
    // flattens every shadow.
    const nightFill = Math.max(0, 1.4 - sky.sunIntensity);
    hemisphere.color
      .set(sky.horizon)
      .lerp(fillColor.set(sky.sunColor), Math.min(0.55, nightFill * 0.5));
    hemisphere.groundColor.set(sky.ground);
    hemisphere.intensity = 0.18 + nightFill * 1.2;
    sun.color.set(sky.sunColor);
    sun.intensity = sky.sunIntensity;
    sun.position.copy(direction).multiplyScalar(60);
    sun.target.position.set(0, 0, 0);
    sun.target.updateMatrixWorld();
    renderer.toneMappingExposure = sky.exposure;
    if (camera.far !== sky.far) {
      camera.far = sky.far;
      camera.updateProjectionMatrix();
    }
    current = sky;
  }

  function useSky(sky: WorldSky): WorldLighting {
    dome = createSkyDome(uniforms, { sunDisc: 40, clouds: sky.clouds });
    dome.onBeforeRender = () => {
      dome?.position.copy(camera.position);
      dome?.updateMatrixWorld();
    };
    scene.add(dome);
    scene.background = null;
    tune(sky);
    return {
      sky: uniforms,
      environment: environmentMap,
      environmentHeight: target?.texture.image.height ?? 0,
    };
  }

  function useFlat(environment: WorldEnvironment): WorldLighting {
    scene.background = new THREE.Color(environment.background);
    scene.fog = new THREE.Fog(
      environment.fog,
      environment.fogNear,
      environment.fogFar,
    );
    scene.environment = null;
    hemisphere.intensity = LEGACY.hemisphere;
    sun.color.set("#fff4da");
    sun.intensity = LEGACY.sun;
    sun.position.copy(LEGACY.sunPosition);
    renderer.toneMappingExposure = LEGACY.exposure;
    camera.far = LEGACY.far;
    camera.updateProjectionMatrix();
    return { sky: uniforms, environment: environmentMap, environmentHeight: 0 };
  }

  return {
    apply(environment, timeOfDay) {
      this.clear();
      const sky =
        environment.timesOfDay?.find((entry) => entry.id === timeOfDay)?.sky ??
        environment.sky;
      return sky ? useSky(sky) : useFlat(environment);
    },

    retune(sky, rebake = true) {
      if (dome) tune(sky, rebake);
    },

    clear() {
      if (dome) {
        scene.remove(dome);
        dome.geometry.dispose();
        dome.material.dispose();
        dome = null;
      }
      if (scene.environment === target?.texture) scene.environment = null;
      target?.dispose();
      target = null;
      environmentMap.value = null;
      scene.fog = null;
      current = null;
    },

    restore() {
      // The prefiltered map lived only on the GPU; geometry and textures are
      // re-uploaded by three from their CPU copies, render targets are not.
      if (current) bake(current);
    },

    dispose() {
      this.clear();
    },
  };
}
