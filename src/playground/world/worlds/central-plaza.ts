/**
 * 01 — Central Plaza / The Commons.
 *
 * The lobby. Its whole job is that arriving here means finding somebody, so
 * everything is arranged around one obvious middle: a fountain you can see
 * from the entrance, a ring of benches facing it, and the Software boards
 * pushed to the north edge.
 *
 * The boards used to stand in the centre, which put the two things a newcomer
 * should notice — people, and things to try — in the same place, competing.
 * A plaza reads as a place to meet when its middle is kept for whoever is
 * standing in it.
 *
 * It is a beach now: the plaza is the flat, trodden top of a sandy point,
 * with open sea ahead of the entrance and dunes behind. Only the scenery
 * changed. The furniture stands where it stood and collides where it
 * collided — `centralGeometry` is shared with the AI Controller and the
 * server's adapter, and the ground under people is still exactly y=0.
 */
import * as THREE from "three";

import {
  CENTRAL_SOFTWARE_SLOTS,
  centralColliders,
  FOUNTAIN_RADIUS,
  CENTRAL_TREES,
  CENTRAL_PLANTERS,
  CENTRAL_BENCHES,
  CENTRAL_LANTERNS,
  CENTRAL_MASCOTS,
} from "./centralGeometry";
import { bench, lantern } from "../primitives";
import { BODY_RADIUS, circle } from "../collision";
import { createBeachAssets, LoadAborted } from "../beach/assets";
import { createCoastUniforms } from "../beach/coastShader";
import { createOcean } from "../beach/ocean";
import { grassPlacements, OUTER_PALMS, placeRocks, sceneryColliders } from "../beach/scenery";
import { beachWalkable, terrainHeight, waterDepth } from "../beach/coast";
import { createTerrain } from "../beach/terrain";
import { createVegetation } from "../beach/vegetation";
import {
  animateMascot,
  createMascot,
  disposeMascot,
  speakMascot,
  updateMascotBubble,
  type Mascot,
} from "../mascot";
import type { Interactable, WorldDefinition, WorldRuntime, WorldSky } from "../types";

/** Height of the fountain's rim and basin floor: one jump (0.85m) clears it. */
const FOUNTAIN_TOP = 0.6;
/** The central pedestal and upper bowl: too tall to climb. */
const FOUNTAIN_COLUMN_RADIUS = 1.15;

/**
 * Late morning over the sea: the sun stands north-west, ahead and to the
 * left of the entrance, so the glitter lies across the water in view.
 */
const DAY_SKY: WorldSky = {
  sunDirection: [-0.62, 0.55, -0.56],
  sunColor: "#fff2dc",
  sunIntensity: 3.1,
  zenith: "#3f7fd0",
  horizon: "#abcae0",
  ground: "#c2ae8a",
  hazeDensity: 0.0042,
  far: 900,
  exposure: 0.9,
  environmentIntensity: 1,
  clouds: 0.5,
};

/**
 * Magic hour: the sun a few degrees above the sea, slightly left of the
 * entrance's view, so the path of light on the water runs toward you.
 */
const MAGIC_HOUR_SKY: WorldSky = {
  sunDirection: [-0.7, 0.07, -0.71],
  sunColor: "#ffa04a",
  sunIntensity: 2.6,
  // Gold at the horizon into deep blue, not mauve: no pink stop between.
  zenith: "#2c5c9c",
  horizon: "#f7b469",
  ground: "#8a6a4e",
  sunDisc: 1.6,
  hazeDensity: 0.0046,
  far: 900,
  exposure: 1.1,
  environmentIntensity: 1.05,
  clouds: 0.6,
};

export const centralPlaza: WorldDefinition = {
  id: "central-plaza",
  name: "CENTRAL PLAZA",
  index: 1,
  tagline: "Start here. Someone's around.",
  spawn: { x: 0, y: 0, z: 11, yaw: 0 },
  environment: {
    background: "#c8e1e0",
    fog: "#c8e1e0",
    fogNear: 26,
    fogFar: 72,
    sky: DAY_SKY,
    timesOfDay: [
      { id: "day", label: "Day", sky: DAY_SKY },
      { id: "magic-hour", label: "Sunset", sky: MAGIC_HOUR_SKY },
    ],
  },
  available: true,

  build({ builder, labelHost, reducedMotion, quality, lighting, signal }): WorldRuntime {
    // The shared colliders (the AI Controller and server use the same list)
    // plus local ones for rocks and palms on the open beach.
    //
    // Locally, the fountain is a step you can jump onto: its wall stops
    // blocking once your feet are level with the rim, and only the column in
    // the middle stays solid. The shared list keeps it a plain wall — the AI
    // never climbs, and the server checks it with exactly that list.
    const fountain = circle(0, 0, FOUNTAIN_RADIUS + 0.1);
    const colliders = [
      ...centralColliders().filter(
        (collider) =>
          !(collider.shape === "circle" && collider.x === 0 && collider.z === 0),
      ),
      { ...fountain, top: FOUNTAIN_TOP },
      circle(0, 0, FOUNTAIN_COLUMN_RADIUS),
      ...sceneryColliders(),
    ];
    const interactables: Interactable[] = [];
    const mascots: Mascot[] = [];

    // ---- shore -----------------------------------------------------------
    // Sand and sea draw immediately from procedural placeholders; scanned
    // textures and rock models refine them as they arrive and never gate the
    // World (or chat) on a download.
    const coast = createCoastUniforms(quality.level === "high" ? 512 : 256);
    builder.trackResource(coast.uCoastField.value);
    const terrain = createTerrain(coast, lighting.sky, quality);
    builder.track(terrain.mesh);
    terrain.resources.forEach((resource) => builder.trackResource(resource));
    const ocean = createOcean(coast, lighting, quality);
    builder.track(ocean.mesh);
    ocean.resources.forEach((resource) => builder.trackResource(resource));

    const assets = createBeachAssets(signal, quality.level === "high" ? 8 : 4);
    const scenery = builder.group();
    scenery.name = "beach-scenery";
    void terrain.load(assets);
    void placeRocks(scenery, assets, signal, (resource) =>
      builder.trackResource(resource),
    ).catch((error: unknown) => {
      if (!(error instanceof LoadAborted)) console.warn("[plaza] rocks unavailable");
    });

    // ---- planting --------------------------------------------------------
    // Palms stand exactly on the old trees' roots (their colliders are
    // unchanged); more frame the view from beyond the walk limit.
    const vegetation = createVegetation(
      [
        ...CENTRAL_TREES.map(([x, z, scale]) => ({ x, z, scale })),
        ...OUTER_PALMS,
      ],
      CENTRAL_PLANTERS,
      quality.scatter ? grassPlacements(220) : [],
      reducedMotion,
    );
    vegetation.objects.forEach((object) => builder.track(object));
    vegetation.resources.forEach((resource) => builder.trackResource(resource));

    // ---- fountain --------------------------------------------------------
    // Weathered coral stone round a pool that takes the sky's reflection.
    builder.cylinder(FOUNTAIN_RADIUS, 0.55, "#d3c3a3", 0, 0.27, 0, 40);
    builder.cylinder(FOUNTAIN_RADIUS - 0.28, 0.5, "#e2d6bd", 0, 0.34, 0, 40);
    builder.cylinder(FOUNTAIN_RADIUS - 0.55, 0.12, "#c2b08f", 0, 0.55, 0, 40);

    const water = builder.cylinder(
      FOUNTAIN_RADIUS - 0.62,
      0.06,
      "#1f7480",
      0,
      0.54,
      0,
      40,
    );
    water.material = builder.material("#1f7480", {
      transparent: true,
      opacity: 0.9,
      roughness: 0.04,
    });
    water.castShadow = false;

    builder.cylinder(0.5, 1.15, "#d9cbaf", 0, 1.1, 0, 20);
    builder.cylinder(1.1, 0.2, "#e2d6bd", 0, 1.75, 0, 24);
    const jet = builder.cylinder(0.12, 1.5, "#a9d8de", 0, 2.5, 0, 12);
    jet.material = builder.material("#a9d8de", {
      basic: true,
      transparent: true,
      opacity: 0.5,
    });
    jet.castShadow = false;

    // Droplets: one Points object, not 80 meshes. A particle system is the
    // one place where a single draw call buys visible life cheaply.
    const dropletCount = 90;
    const positions = new Float32Array(dropletCount * 3);
    const seeds = new Float32Array(dropletCount);
    for (let i = 0; i < dropletCount; i += 1) {
      seeds[i] = Math.random();
      positions[i * 3] = 0;
      positions[i * 3 + 1] = 2;
      positions[i * 3 + 2] = 0;
    }
    const dropletGeometry = new THREE.BufferGeometry();
    dropletGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3),
    );
    const droplets = new THREE.Points(
      dropletGeometry,
      new THREE.PointsMaterial({
        color: "#e8f6f8",
        size: 0.07,
        transparent: true,
        opacity: 0.85,
      }),
    );
    builder.track(droplets);

    // ---- furniture -------------------------------------------------------
    // Planters keep their footprint (and collider): coral-stone boxes of
    // dark soil, the ferns in them come from the vegetation above.
    for (const [x, z] of CENTRAL_PLANTERS) {
      builder.box(3, 0.55, 1.3, "#cbb995", x, 0.27, z);
      builder.box(2.8, 0.12, 1.1, "#4f4232", x, 0.57, z);
    }

    // Benches face the fountain: a ring of seats around a middle is what
    // makes a square somewhere to wait rather than somewhere to cross.
    for (const [x, z, rotation] of CENTRAL_BENCHES) {
      bench(builder, x, z, rotation, {
        seat: "#a3896c",
        back: "#b09878",
        legs: "#5a4a3a",
      });
    }

    for (const [x, z] of CENTRAL_LANTERNS) {
      lantern(builder, x, z, "#ffe2a8", 3.1, "#6b563f");
    }

    // ---- mascots ---------------------------------------------------------
    for (const spec of CENTRAL_MASCOTS) {
      const mascot = createMascot(builder, labelHost, spec);
      mascots.push(mascot);
      interactables.push({
        kind: "mascot",
        id: mascot.id,
        title: mascot.name,
        anchor: mascot.anchor,
        activate: () => speakMascot(mascot, performance.now()),
      });
    }

    return {
      colliders,
      interactables,

      // North edge, facing back into the plaza, so the fountain keeps the
      // middle and the boards are still the first thing beyond it.
      softwareSlots: CENTRAL_SOFTWARE_SLOTS,

      labels: mascots.map((mascot) => ({
        element: mascot.label,
        position: new THREE.Vector3(
          mascot.group.position.x,
          mascot.baseY + 0.15,
          mascot.group.position.z,
        ),
      })),

      // The plaza is flat at 0; beyond it people may walk the beach down
      // into the shallows, slower once the water is above the ankles.
      walkable: beachWalkable,
      // The fountain's top covers its whole collider plus a body radius, so a
      // body allowed to overlap the wall is always standing on it.
      groundY: (x, z) =>
        Math.hypot(x, z) < fountain.r + BODY_RADIUS ? FOUNTAIN_TOP : terrainHeight(x, z),
      speedScale: (x, z) => {
        const depth = waterDepth(x, z);
        return depth <= 0.1 ? 1 : depth >= 0.5 ? 0.55 : 1 - (depth - 0.1) * 1.125;
      },

      update(_dt, now) {
        // One local clock drives water, sand and wind; nothing about the sea
        // is synchronised over the network. Reduced motion slows it down.
        const seconds = (now / 1000) * (reducedMotion ? 0.4 : 1);
        coast.uTime.value = seconds;
        vegetation.wind.uTime.value = seconds;
        for (const mascot of mascots) {
          animateMascot(mascot, now, reducedMotion);
          updateMascotBubble(mascot, now);
        }
        if (reducedMotion) return;
        // Droplets arc out of the jet and fall back into the basin, each on
        // its own phase so the spray never pulses as one body.
        const attribute = dropletGeometry.getAttribute(
          "position",
        ) as THREE.BufferAttribute;
        for (let i = 0; i < dropletCount; i += 1) {
          const seed = seeds[i];
          const t = ((now * 0.0009 + seed) % 1) * 1.6;
          const angle = seed * Math.PI * 2;
          const spread = t * 0.9;
          attribute.setXYZ(
            i,
            Math.cos(angle) * spread,
            3.15 - 9.81 * 0.5 * t * t * 0.42,
            Math.sin(angle) * spread,
          );
        }
        attribute.needsUpdate = true;
      },

      dispose() {
        // Only what the builder does not know about: the DOM labels. Meshes,
        // materials and textures are the engine's builder to release.
        for (const mascot of mascots) disposeMascot(mascot);
      },
    };
  },
};
