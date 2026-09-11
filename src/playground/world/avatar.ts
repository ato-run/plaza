/**
 * A low-poly humanoid, plus the HTML label that floats over it.
 *
 * Boxes rather than a loaded model: the whole point of this PoC is that a
 * room full of people costs almost nothing to draw, and a rigged mesh would
 * add a loader, an asset pipeline and a licence question for no gain at this
 * stage.
 *
 * Name tags, speech bubbles and reactions are DOM, not sprites. Text drawn
 * into a canvas texture is blurry at distance, cannot be selected, and is
 * invisible to assistive technology; an absolutely-positioned element
 * projected to the head's screen position stays crisp and readable.
 *
 * NOTE: the local player's own body is deliberately never built — this is a
 * fixed first-person view, and a self-avatar would only ever be seen from
 * inside its own head.
 */
import * as THREE from "three";

import {
  approachAngle,
  EYE_HEIGHT,
  lerp,
  smoothing,
  type RemoteTransform,
} from "./worldMath";

/** How far a seated body drops from its standing height. */
const SIT_DROP = 0.42;

/** Skin/shirt palette, chosen deterministically from the principal id. */
const SHIRT_COLORS = ["#c2795c", "#587d94", "#d2ad63", "#7e779c"];

function colorFor(principalId: string): string {
  let hash = 0;
  for (let i = 0; i < principalId.length; i += 1) {
    hash = (hash * 31 + principalId.charCodeAt(i)) >>> 0;
  }
  return SHIRT_COLORS[hash % SHIRT_COLORS.length];
}

function box(
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  color: string,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.92 }),
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export interface Avatar {
  principalId: string;
  group: THREE.Group;
  head: THREE.Group;
  limbs: THREE.Group[];
  label: HTMLDivElement;
  nameTag: HTMLDivElement;
  bubble: HTMLDivElement;
  reaction: HTMLDivElement;
  /** Where the network says they are; the group eases toward it. */
  target: THREE.Vector3;
  /** Interpolated floor height, kept apart from the walk bob added on top. */
  baseY: number;
  targetYaw: number;
  targetPitch: number;
  movement: "idle" | "walk";
  pose: "stand" | "sit";
  /** True until the first transform, so we can place rather than glide. */
  awaitingFirstTransform: boolean;
}

export function createAvatar(
  scene: THREE.Scene,
  labelHost: HTMLElement,
  principalId: string,
  displayName: string,
): Avatar {
  const group = new THREE.Group();
  scene.add(group);

  const shirt = colorFor(principalId);
  box(group, 0.48, 0.62, 0.29, shirt, 0, 1.03, 0);

  const head = new THREE.Group();
  head.position.y = 1.54;
  group.add(head);
  box(head, 0.4, 0.4, 0.38, "#e2b78f", 0, 0, 0);
  box(head, 0.43, 0.15, 0.42, "#4b443b", 0, 0.19, 0);
  // Eyes, so which way a head is turned is legible at a glance.
  box(head, 0.045, 0.05, 0.012, "#343d35", -0.09, 0.01, 0.196);
  box(head, 0.045, 0.05, 0.012, "#343d35", 0.09, 0.01, 0.196);

  const limbs: THREE.Group[] = [];
  for (let i = 0; i < 4; i += 1) {
    const limb = new THREE.Group();
    const isArm = i < 2;
    limb.position.set(
      isArm ? (i ? 1 : -1) * 0.31 : (i === 2 ? -1 : 1) * 0.135,
      isArm ? 1.28 : 0.75,
      0,
    );
    group.add(limb);
    box(
      limb,
      isArm ? 0.17 : 0.2,
      isArm ? 0.53 : 0.65,
      0.23,
      isArm ? shirt : "#4f605b",
      0,
      isArm ? -0.2 : -0.32,
      0,
    );
    if (!isArm) box(limb, 0.22, 0.13, 0.32, "#e5e8df", 0, -0.67, 0.05);
    limbs.push(limb);
  }

  const label = document.createElement("div");
  label.className = "pg-label";
  const reaction = document.createElement("div");
  reaction.className = "pg-reaction";
  const bubble = document.createElement("div");
  bubble.className = "pg-speech";
  const nameTag = document.createElement("div");
  nameTag.className = "pg-nametag";
  nameTag.textContent = displayName;
  label.append(reaction, bubble, nameTag);
  labelHost.append(label);

  return {
    principalId,
    group,
    head,
    limbs,
    label,
    nameTag,
    bubble,
    reaction,
    target: new THREE.Vector3(0, 0, 0),
    baseY: 0,
    targetYaw: 0,
    targetPitch: 0,
    movement: "idle",
    pose: "stand",
    awaitingFirstTransform: true,
  };
}

/**
 * Point an avatar at a newly received transform.
 *
 * The first one SNAPS. Easing from the origin would send every avatar
 * sliding in from the middle of the plaza when a roster arrives, which reads
 * as everyone teleporting rather than as everyone already being there.
 */
export function receiveTransform(avatar: Avatar, transform: RemoteTransform): void {
  // `y` is the sender's EYE height; a body stands that far below its own eyes.
  // It used to be ignored, which was harmless while every World was flat and
  // wrong the moment one had a raised deck: two people on different floors of
  // the Treehouse would stand in each other.
  avatar.target.set(transform.x, transform.y - EYE_HEIGHT, transform.z);
  avatar.targetYaw = transform.yaw;
  avatar.targetPitch = transform.pitch;
  avatar.movement = transform.movement;
  avatar.pose = transform.pose;
  if (avatar.awaitingFirstTransform) {
    avatar.group.position.copy(avatar.target);
    avatar.group.rotation.y = transform.yaw + Math.PI;
    avatar.awaitingFirstTransform = false;
  }
}

/**
 * Ease toward the last reported transform and animate the walk cycle.
 *
 * Interpolation is what turns 12 updates a second into smooth motion; without
 * it every avatar visibly steps 12 times a second. `+π` on the yaw because
 * the body model faces +Z while a camera at yaw=0 looks down -Z.
 */
export function animateAvatar(
  avatar: Avatar,
  now: number,
  dt: number,
  reducedMotion: boolean,
): void {
  const t = smoothing(dt, 12);
  avatar.group.position.x = lerp(avatar.group.position.x, avatar.target.x, t);
  avatar.group.position.z = lerp(avatar.group.position.z, avatar.target.z, t);
  const baseY = lerp(avatar.baseY, avatar.target.y, t);
  avatar.baseY = baseY;
  avatar.group.rotation.y = approachAngle(
    avatar.group.rotation.y,
    avatar.targetYaw + Math.PI,
    dt,
    12,
  );
  // Gaze: the head carries the remote pitch, so you can tell whether somebody
  // is looking at you or past you.
  avatar.head.rotation.x = avatar.targetPitch;

  // Sitting: knees forward, and the whole body dropped to bench height. A
  // seated pose that kept standing legs would have people hovering through
  // the log they are supposedly sitting on.
  const sitting = avatar.pose === "sit";
  if (sitting) {
    avatar.limbs.forEach((limb, i) => {
      limb.rotation.x = i < 2 ? 0.15 : -1.35;
    });
    avatar.group.position.y = baseY - SIT_DROP;
    return;
  }

  if (reducedMotion) {
    avatar.limbs.forEach((limb) => {
      limb.rotation.x = 0;
    });
    avatar.group.position.y = baseY;
    return;
  }

  const walking = avatar.movement === "walk";
  avatar.limbs.forEach((limb, i) => {
    limb.rotation.x = walking
      ? Math.sin(now * 0.009 + (i % 2) * Math.PI) * 0.5
      : Math.sin(now * 0.0018 + i) * 0.015;
  });
  avatar.group.position.y =
    baseY +
    (walking
      ? Math.abs(Math.sin(now * 0.009)) * 0.035
      : Math.sin(now * 0.002) * 0.008);
}

export function disposeAvatar(scene: THREE.Scene, avatar: Avatar): void {
  scene.remove(avatar.group);
  avatar.group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      materials.forEach((material) => material.dispose());
    }
  });
  avatar.label.remove();
}
