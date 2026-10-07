/**
 * ナギ, standing by the entrance: a person-shaped guide, not a mascot.
 *
 * Built in the plaza's own blocky avatar language (so she reads as someone
 * you can talk to), but marked as staff: a straw hat, a satchel, a teal
 * uniform. She breathes, turns her head toward you when you are near, greets
 * you once when you first come close, and speaks in a bubble. Everything
 * about the conversation itself lives in the page (see guide/nagi.ts); the
 * World only places her, animates her and shows what she says.
 */
import * as THREE from "three";

import type { WorldBuilder } from "./primitives";

export const GUIDE_ID = "nagi";
export const GUIDE_NAME = "ナギ";
const GREET_DISTANCE = 6;
const LOOK_DISTANCE = 8;

export interface GuideNpc {
  group: THREE.Group;
  label: HTMLElement;
  anchor: THREE.Vector3;
  labelPosition: THREE.Vector3;
  update(now: number, eye: THREE.Vector3 | undefined, reducedMotion: boolean): void;
  say(text: string, now: number, durationMs?: number): void;
  dispose(): void;
}

export function createGuideNpc(
  builder: WorldBuilder,
  labelHost: HTMLElement,
  spec: { x: number; z: number; yaw: number; greeting: string },
): GuideNpc {
  const group = builder.group();
  group.name = "guide:nagi";
  group.position.set(spec.x, 0, spec.z);
  group.rotation.y = spec.yaw;

  const uniform = "#2f7f7a";
  const trousers = "#e9e1cf";
  const skin = "#d9a57e";
  const hair = "#2f2722";
  // Body: legs, torso with a lighter collar and a satchel strap.
  builder.box(0.17, 0.72, 0.2, trousers, -0.12, 0.36, 0, group);
  builder.box(0.17, 0.72, 0.2, trousers, 0.12, 0.36, 0, group);
  builder.box(0.48, 0.6, 0.29, uniform, 0, 1.02, 0, group);
  builder.box(0.3, 0.06, 0.3, "#f4efe2", 0, 1.3, 0.005, group);
  const strap = builder.box(0.06, 0.66, 0.3, "#7a5534", 0, 1.02, 0, group);
  strap.rotation.z = 0.62;
  builder.box(0.24, 0.2, 0.1, "#8b6240", 0.2, 0.74, 0.16, group);
  // Arms hang relaxed, slightly forward.
  const arms: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.31, 1.28, 0);
    group.add(arm);
    builder.box(0.14, 0.56, 0.16, uniform, 0, -0.26, 0, arm);
    builder.box(0.12, 0.12, 0.13, skin, 0, -0.58, 0, arm);
    arm.rotation.x = -0.08;
    arms.push(arm);
  }

  // Head: face, hair, eyes, and a woven straw hat (brim + crown + band).
  const head = new THREE.Group();
  head.position.y = 1.55;
  group.add(head);
  builder.box(0.4, 0.4, 0.38, skin, 0, 0, 0, head);
  builder.box(0.43, 0.14, 0.42, hair, 0, 0.18, -0.02, head);
  builder.box(0.42, 0.26, 0.08, hair, 0, 0.02, -0.18, head);
  builder.box(0.045, 0.05, 0.012, "#2f3530", -0.09, 0.01, 0.196, head);
  builder.box(0.045, 0.05, 0.012, "#2f3530", 0.09, 0.01, 0.196, head);
  builder.box(0.12, 0.025, 0.012, "#b8735f", 0, -0.1, 0.196, head);
  const straw = builder.material("#d8bd84", { roughness: 0.95 });
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.44, 0.03, 28), straw);
  brim.position.y = 0.25;
  brim.castShadow = true;
  builder.track(brim, head);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.23, 0.17, 24), straw);
  crown.position.y = 0.34;
  crown.castShadow = true;
  builder.track(crown, head);
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(0.232, 0.232, 0.04, 24),
    builder.material(uniform),
  );
  band.position.y = 0.29;
  builder.track(band, head);

  // A bubble for what she says; no floating name tag (the prompt names her).
  const label = document.createElement("div");
  label.className = "pg-label";
  const bubble = document.createElement("div");
  bubble.className = "pg-speech pg-speech--guide";
  bubble.style.display = "none";
  label.append(bubble);
  labelHost.append(label);

  let spokenUntil = 0;
  let greeted = false;
  const restYaw = 0;
  const toEye = new THREE.Vector3();

  const npc: GuideNpc = {
    group,
    label,
    anchor: new THREE.Vector3(spec.x, 1.45, spec.z),
    labelPosition: new THREE.Vector3(spec.x, 2.15, spec.z),

    say(text, now, durationMs = 6500) {
      bubble.textContent = text;
      spokenUntil = now + durationMs;
    },

    update(now, eye, reducedMotion) {
      bubble.style.display = now < spokenUntil ? "block" : "none";
      let target = restYaw;
      if (eye) {
        toEye.set(eye.x - spec.x, 0, eye.z - spec.z);
        const distance = toEye.length();
        if (distance < LOOK_DISTANCE) {
          // Head turns toward you, within what a neck can do.
          const world = Math.atan2(toEye.x, toEye.z);
          let relative = world - spec.yaw;
          relative = Math.atan2(Math.sin(relative), Math.cos(relative));
          target = Math.max(-1.1, Math.min(1.1, relative));
        }
        if (!greeted && distance < GREET_DISTANCE) {
          greeted = true;
          npc.say(spec.greeting, now);
        }
      }
      head.rotation.y += (target - head.rotation.y) * (reducedMotion ? 1 : 0.08);
      if (reducedMotion) return;
      const t = now * 0.001;
      group.position.y = Math.sin(t * 1.4) * 0.008;
      arms[0].rotation.x = -0.08 + Math.sin(t * 1.4) * 0.03;
      arms[1].rotation.x = -0.08 - Math.sin(t * 1.4) * 0.03;
    },

    dispose() {
      label.remove();
    },
  };
  return npc;
}
