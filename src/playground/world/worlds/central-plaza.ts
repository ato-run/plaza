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
import { BODY_RADIUS, circle } from "../collision";
import { createBeachAssets, LoadAborted } from "../beach/assets";
import { createCoastUniforms } from "../beach/coastShader";
import { createOcean } from "../beach/ocean";
import { grassPlacements, OUTER_PALMS, placeRocks, sceneryColliders } from "../beach/scenery";
import { beachWalkable, terrainHeight, waterDepth } from "../beach/coast";
import { createTerrain } from "../beach/terrain";
import { createVegetation } from "../beach/vegetation";
import { buildPlazaProps } from "../beach/props";
import { createGuideNpc, GUIDE_ID, GUIDE_NAME } from "../guideNpc";
import { reply } from "../../guide/nagi";

/** ナギ stands just ahead of the entrance, turned toward whoever arrives. */
const GUIDE_SPOT = { x: 2.6, z: 8.4 } as const;
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
      // The guide, locally only: the AI's shared map does not know her.
      circle(GUIDE_SPOT.x, GUIDE_SPOT.z, 0.45),
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
      [],
      quality.scatter ? grassPlacements(220) : [],
      reducedMotion,
    );
    vegetation.objects.forEach((object) => builder.track(object));
    vegetation.resources.forEach((resource) => builder.trackResource(resource));

    // ---- furniture -------------------------------------------------------
    // The fountain, benches facing it, planters and lamp posts: modelled
    // with scanned surfaces, on the same footprints and colliders as before.
    const props = buildPlazaProps(builder, {
      benches: CENTRAL_BENCHES,
      planters: CENTRAL_PLANTERS,
      lanterns: CENTRAL_LANTERNS,
      assets,
      signal,
      reducedMotion,
    });

    // ---- guide -----------------------------------------------------------
    const guide = createGuideNpc(builder, labelHost, {
      ...GUIDE_SPOT,
      yaw: Math.atan2(0 - GUIDE_SPOT.x, 11 - GUIDE_SPOT.z),
      // The first line she says, unprompted, when you first come close.
      greeting: reply("greeting", {
        touch: false,
        lookMode: "lock",
        engaged: true,
        canPost: true,
        peopleNearby: 0,
        exhibits: 0,
        hasTimesOfDay: true,
      }).text,
    });
    interactables.push({
      kind: "guide",
      id: GUIDE_ID,
      title: GUIDE_NAME,
      anchor: guide.anchor,
    });

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

      guide: {
        say: (text, durationMs) => guide.say(text, performance.now(), durationMs),
      },

      labels: [{ element: guide.label, position: guide.labelPosition }, ...mascots.map((mascot) => ({
        element: mascot.label,
        position: new THREE.Vector3(
          mascot.group.position.x,
          mascot.baseY + 0.15,
          mascot.group.position.z,
        ),
      }))],

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

      update(_dt, now, eye) {
        // One local clock drives water, sand and wind; nothing about the sea
        // is synchronised over the network. Reduced motion slows it down.
        const seconds = (now / 1000) * (reducedMotion ? 0.4 : 1);
        coast.uTime.value = seconds;
        vegetation.wind.uTime.value = seconds;
        guide.update(now, eye, reducedMotion);
        for (const mascot of mascots) {
          animateMascot(mascot, now, reducedMotion);
          updateMascotBubble(mascot, now);
        }
        props.update(seconds);
      },

      dispose() {
        // Only what the builder does not know about: the DOM labels. Meshes,
        // materials and textures are the engine's builder to release.
        for (const mascot of mascots) disposeMascot(mascot);
        guide.dispose();
      },
    };
  },
};
