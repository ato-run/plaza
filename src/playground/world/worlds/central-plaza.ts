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
 */
import * as THREE from "three";

import { circle, type Collider } from "../collision";
import { bench, lantern, planter, tree } from "../primitives";
import {
  animateMascot,
  createMascot,
  disposeMascot,
  speakMascot,
  updateMascotBubble,
  type Mascot,
} from "../mascot";
import type { Interactable, WorldDefinition, WorldRuntime } from "../types";

const FOUNTAIN_RADIUS = 3.2;

export const centralPlaza: WorldDefinition = {
  id: "central-plaza",
  name: "CENTRAL PLAZA",
  index: 1,
  tagline: "まずここへ来れば、誰かいる。",
  spawn: { x: 0, y: 0, z: 11, yaw: 0 },
  environment: {
    background: "#c8e1e0",
    fog: "#c8e1e0",
    fogNear: 26,
    fogFar: 72,
  },
  available: true,

  build({ builder, labelHost, reducedMotion }): WorldRuntime {
    const colliders: Collider[] = [];
    const interactables: Interactable[] = [];
    const mascots: Mascot[] = [];

    // ---- ground ----------------------------------------------------------
    builder.box(200, 0.4, 200, "#95b68d", 0, -0.35, 0);
    builder.cylinder(19, 0.18, "#d8ded0", 0, -0.08, 0, 64);
    builder.cylinder(13, 0.04, "#e4e6da", 0, 0.03, 0, 64);

    // Paving joints — quiet detail that makes movement legible underfoot.
    for (let i = -18; i <= 18; i += 3) {
      builder.box(0.025, 0.009, 35, "#bbc9b8", i, 0.016, 0);
      builder.box(35, 0.009, 0.025, "#bbc9b8", 0, 0.018, i);
    }

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(6.4, 6.44, 80),
      builder.material("#a6b8a2", { basic: true }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.058;
    builder.track(ring);

    // ---- fountain --------------------------------------------------------
    // Three stacked stone rings, then water. The water is unlit and slightly
    // transparent so it reads as a surface rather than as another stone.
    builder.cylinder(FOUNTAIN_RADIUS, 0.55, "#c3c9bd", 0, 0.27, 0, 40);
    builder.cylinder(FOUNTAIN_RADIUS - 0.28, 0.5, "#d6dbcf", 0, 0.34, 0, 40);
    builder.cylinder(FOUNTAIN_RADIUS - 0.55, 0.12, "#b3bcae", 0, 0.55, 0, 40);

    const water = builder.cylinder(
      FOUNTAIN_RADIUS - 0.62,
      0.06,
      "#7fb9c4",
      0,
      0.54,
      0,
      40,
    );
    water.material = builder.material("#7fb9c4", {
      basic: true,
      transparent: true,
      opacity: 0.68,
    });
    water.castShadow = false;

    builder.cylinder(0.5, 1.15, "#c9cec2", 0, 1.1, 0, 20);
    builder.cylinder(1.1, 0.2, "#d6dbcf", 0, 1.75, 0, 24);
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

    colliders.push(circle(0, 0, FOUNTAIN_RADIUS + 0.1));

    // ---- planting and furniture -----------------------------------------
    (
      [
        [-9, -7, 1.3],
        [10, -9, 1.4],
        [-13, 2, 1.3],
        [13, 4, 1.5],
        [-7, -16, 1.7],
        [6, -18, 1.5],
        [-18, -10, 1.8],
        [18, -13, 1.7],
        [-17, 13, 1.4],
        [17, 16, 1.3],
        [-3, 21, 1.4],
      ] as const
    ).forEach(([x, z, scale]) => {
      tree(builder, x, z, scale);
      colliders.push(circle(x, z, 0.5));
    });

    for (const [x, z] of [
      [-9.5, 4],
      [9.5, 4],
      [0, 13],
    ] as const) {
      planter(builder, x, z);
      colliders.push(circle(x, z, 1.6));
    }

    // Benches face the fountain: a ring of seats around a middle is what
    // makes a square somewhere to wait rather than somewhere to cross.
    for (const [x, z, rotation] of [
      [0, 6.6, Math.PI],
      [6.6, 0, -Math.PI / 2],
      [-6.6, 0, Math.PI / 2],
      [0, -6.6, 0],
    ] as const) {
      bench(builder, x, z, rotation);
      colliders.push(circle(x, z, 1.5));
    }

    for (const [x, z] of [
      [-9, 9],
      [9, 9],
      [-9, -9],
      [9, -9],
      [0, 17],
    ] as const) {
      lantern(builder, x, z);
      colliders.push(circle(x, z, 0.3));
    }

    // ---- mascots ---------------------------------------------------------
    const specs = [
      { id: "cat", name: "ミケ", species: "cat" as const, x: -5.4, z: 4.6, yaw: 2.4 },
      { id: "dog", name: "ソラ", species: "dog" as const, x: 3.9, z: 4.2, yaw: -2.6 },
      { id: "panda", name: "モモ", species: "panda" as const, x: -2.2, z: -9.4, yaw: 0.4 },
    ];
    for (const spec of specs) {
      const mascot = createMascot(builder, labelHost, spec);
      mascots.push(mascot);
      colliders.push(circle(spec.x, spec.z, 0.45));
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
      softwareSlots: [
        { id: "plaza-01", x: -6.4, z: -12.6 },
        { id: "plaza-02", x: 0, z: -13.4 },
        { id: "plaza-03", x: 6.4, z: -12.6 },
        { id: "plaza-04", x: -12.4, z: -8.2, rotation: 0.6 },
        { id: "plaza-05", x: 12.4, z: -8.2, rotation: -0.6 },
      ],

      update(_dt, now) {
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
