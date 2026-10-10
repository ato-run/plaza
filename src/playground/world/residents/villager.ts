import { driftwoodWork } from "../openAir/work";
import { shellArrangement } from "../openAir/model";
import type { OpenAirRuntime } from "../openAir/scene";
import {
  activeLease,
  itemPosition,
  ITEMS,
  type ResidentId,
} from "../openAir/model";
import { OPEN_AIR_PLACES, landmarkGround } from "../openAir/layout";
import { worldMoment } from "../openAir/clock";
import { terrainHeight } from "../beach/coast";
import { findPath, type Grid } from "./schedule";
import { residentReaction } from "./reaction";
/**
 * The residents in the scene: one merged, vertex-coloured mesh for each body
 * and one for each head (two draw calls a resident), animated with a
 * villager's waddle, sitting on benches, turning to look at whoever they are
 * talking to, and speaking in bubbles.
 */
import * as THREE from "three";

import { circle, type CircleCollider } from "../collision";
import type { Interactable } from "../types";
import type { WorldBuilder } from "../primitives";
import { CHATTER, LINES, type ResidentSpec, type Species } from "./cast";
import { hash01, separate, type Schedule } from "./schedule";

interface Look {
  fur: string;
  accent: string;
  belly: string;
  ears: "pointed" | "round" | "floppy" | "long" | "tufts" | "none";
  muzzle: "snout" | "beak" | "nose" | "none";
  eyes?: "patches" | "top";
}

const LOOKS: Record<Species, Look> = {
  cat: {
    fur: "#c9b49a",
    accent: "#8f7b66",
    belly: "#efe4d4",
    ears: "pointed",
    muzzle: "snout",
  },
  dog: {
    fur: "#c99a63",
    accent: "#8a5f35",
    belly: "#f1e3cf",
    ears: "floppy",
    muzzle: "snout",
  },
  panda: {
    fur: "#f2f0ea",
    accent: "#2f2f2f",
    belly: "#ffffff",
    ears: "round",
    muzzle: "nose",
    eyes: "patches",
  },
  fox: {
    fur: "#d47a3e",
    accent: "#8f4a22",
    belly: "#f6e8d8",
    ears: "pointed",
    muzzle: "snout",
  },
  penguin: {
    fur: "#34404c",
    accent: "#222a31",
    belly: "#f2f1e7",
    ears: "none",
    muzzle: "beak",
  },
  rabbit: {
    fur: "#e6ded3",
    accent: "#c8bdb0",
    belly: "#f8f4ee",
    ears: "long",
    muzzle: "nose",
  },
  bear: {
    fur: "#8a5a3a",
    accent: "#5e3b24",
    belly: "#c49a75",
    ears: "round",
    muzzle: "snout",
  },
  koala: {
    fur: "#9aa0a6",
    accent: "#6b7076",
    belly: "#e3e5e6",
    ears: "round",
    muzzle: "nose",
  },
  frog: {
    fur: "#7fb35a",
    accent: "#4f7f35",
    belly: "#e6efb5",
    ears: "none",
    muzzle: "none",
    eyes: "top",
  },
  owl: {
    fur: "#9b7b56",
    accent: "#6a5038",
    belly: "#ead9bd",
    ears: "tufts",
    muzzle: "beak",
  },
};

const color = new THREE.Color();
function part(
  parts: THREE.BufferGeometry[],
  w: number,
  h: number,
  d: number,
  hex: string,
  x: number,
  y: number,
  z: number,
  rotZ = 0,
): void {
  const geometry = new THREE.BoxGeometry(w, h, d);
  if (rotZ) geometry.rotateZ(rotZ);
  geometry.translate(x, y, z);
  color.set(hex);
  const count = geometry.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) color.toArray(colors, i * 3);
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  parts.push(geometry);
}

/** Head centre sits this far above the neck pivot. */
const HEAD = 0.26;
const NECK = 0.56;

function bodyGeometry(look: Look, shirt: string): THREE.BufferGeometry[] {
  const p: THREE.BufferGeometry[] = [];
  part(p, 0.13, 0.2, 0.15, look.fur, -0.1, 0.1, 0);
  part(p, 0.13, 0.2, 0.15, look.fur, 0.1, 0.1, 0);
  part(p, 0.4, 0.34, 0.29, shirt, 0, 0.37, 0);
  part(p, 0.24, 0.2, 0.012, look.belly, 0, 0.36, 0.151);
  part(p, 0.11, 0.26, 0.12, shirt, -0.26, 0.4, 0, 0.18);
  part(p, 0.11, 0.26, 0.12, shirt, 0.26, 0.4, 0, -0.18);
  part(p, 0.1, 0.09, 0.1, look.fur, -0.3, 0.25, 0);
  part(p, 0.1, 0.09, 0.1, look.fur, 0.3, 0.25, 0);
  return p;
}

function headGeometry(look: Look): THREE.BufferGeometry[] {
  const p: THREE.BufferGeometry[] = [];
  const front = 0.25;
  part(p, 0.54, 0.5, 0.5, look.fur, 0, HEAD, 0);
  // Every decoration stands clear of the face plane (no z-fighting).
  if (look.eyes === "patches") {
    part(p, 0.13, 0.13, 0.012, look.accent, -0.12, HEAD + 0.03, front + 0.007);
    part(p, 0.13, 0.13, 0.012, look.accent, 0.12, HEAD + 0.03, front + 0.007);
  }
  if (look.eyes === "top") {
    part(p, 0.14, 0.12, 0.14, look.fur, -0.15, HEAD + 0.29, 0.1);
    part(p, 0.14, 0.12, 0.14, look.fur, 0.15, HEAD + 0.29, 0.1);
    part(p, 0.06, 0.07, 0.012, "#20262a", -0.15, HEAD + 0.3, 0.177);
    part(p, 0.06, 0.07, 0.012, "#20262a", 0.15, HEAD + 0.3, 0.177);
    part(p, 0.24, 0.025, 0.012, "#4a2f2a", 0, HEAD - 0.06, front + 0.007);
  } else {
    const eyeZ = front + (look.eyes === "patches" ? 0.02 : 0.007);
    part(p, 0.055, 0.08, 0.012, "#20262a", -0.12, HEAD + 0.03, eyeZ);
    part(p, 0.055, 0.08, 0.012, "#20262a", 0.12, HEAD + 0.03, eyeZ);
    part(p, 0.06, 0.03, 0.012, "#e7a7a0", -0.18, HEAD - 0.06, front + 0.007);
    part(p, 0.06, 0.03, 0.012, "#e7a7a0", 0.18, HEAD - 0.06, front + 0.007);
  }
  if (look.muzzle === "snout") {
    part(p, 0.2, 0.12, 0.1, look.belly, 0, HEAD - 0.07, front + 0.05);
    part(p, 0.07, 0.05, 0.03, "#3a2a24", 0, HEAD - 0.03, front + 0.105);
  } else if (look.muzzle === "beak") {
    part(p, 0.1, 0.07, 0.1, "#e9a43a", 0, HEAD - 0.06, front + 0.05);
  } else if (look.muzzle === "nose") {
    part(p, 0.1, 0.07, 0.03, look.accent, 0, HEAD - 0.05, front + 0.015);
  }
  switch (look.ears) {
    case "pointed":
      part(p, 0.13, 0.16, 0.06, look.accent, -0.17, HEAD + 0.31, 0, 0.25);
      part(p, 0.13, 0.16, 0.06, look.accent, 0.17, HEAD + 0.31, 0, -0.25);
      break;
    case "round":
      part(p, 0.15, 0.15, 0.07, look.accent, -0.22, HEAD + 0.27, 0);
      part(p, 0.15, 0.15, 0.07, look.accent, 0.22, HEAD + 0.27, 0);
      break;
    case "floppy":
      part(p, 0.09, 0.26, 0.16, look.accent, -0.31, HEAD + 0.02, 0, 0.15);
      part(p, 0.09, 0.26, 0.16, look.accent, 0.31, HEAD + 0.02, 0, -0.15);
      break;
    case "long":
      part(p, 0.1, 0.36, 0.07, look.fur, -0.11, HEAD + 0.42, 0, 0.08);
      part(p, 0.1, 0.36, 0.07, look.fur, 0.11, HEAD + 0.42, 0, -0.08);
      part(p, 0.05, 0.26, 0.012, "#e9b3b3", -0.11, HEAD + 0.42, 0.042, 0.08);
      part(p, 0.05, 0.26, 0.012, "#e9b3b3", 0.11, HEAD + 0.42, 0.042, -0.08);
      break;
    case "tufts":
      part(p, 0.09, 0.14, 0.05, look.accent, -0.2, HEAD + 0.31, 0, 0.35);
      part(p, 0.09, 0.14, 0.05, look.accent, 0.2, HEAD + 0.31, 0, -0.35);
      break;
    default:
      break;
  }
  return p;
}

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Inline merge (same attribute layout for every box).
  let vertices = 0;
  let indices = 0;
  for (const geometry of parts) {
    vertices += geometry.getAttribute("position").count;
    indices += geometry.getIndex()!.count;
  }
  const position = new Float32Array(vertices * 3);
  const normal = new Float32Array(vertices * 3);
  const colours = new Float32Array(vertices * 3);
  const index = new Uint32Array(indices);
  let vo = 0;
  let io = 0;
  for (const geometry of parts) {
    const count = geometry.getAttribute("position").count;
    position.set(
      geometry.getAttribute("position").array as Float32Array,
      vo * 3,
    );
    normal.set(geometry.getAttribute("normal").array as Float32Array, vo * 3);
    colours.set(geometry.getAttribute("color").array as Float32Array, vo * 3);
    const source = geometry.getIndex()!.array;
    for (let i = 0; i < source.length; i += 1) index[io + i] = source[i] + vo;
    vo += count;
    io += source.length;
    geometry.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(position, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  out.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  return out;
}

export interface Residents {
  colliders: CircleCollider[];
  interactables: Interactable[];
  labels: { element: HTMLElement; position: THREE.Vector3 }[];
  /** `others` are characters residents must keep clear of (Nagi). */
  update(
    eye: THREE.Vector3 | undefined,
    reducedMotion: boolean,
    others?: readonly { x: number; z: number }[],
  ): void;
  /**
   * Keep a resident where they are, facing you, while you talk to them —
   * for this viewer only; then they walk back into their day.
   */
  hold(id: string, on: boolean): void;
  react(id: string, emoji: string): void;
  dispose(): void;
}

interface Live {
  spec: ResidentSpec;
  group: THREE.Group;
  head: THREE.Mesh;
  tool: THREE.Mesh;
  activitySeen: number;
  leaseKey: string | null;
  leaseActive: boolean;
  escortDistance: number;
  lastUpdate: number;
  bubble: HTMLDivElement;
  label: HTMLDivElement;
  labelPosition: THREE.Vector3;
  anchor: THREE.Vector3;
  collider: CircleCollider;
  yaw: number;
  headYaw: number;
  /** Local overrides, in ms of Date.now(). */
  saying: { text: string; until: number } | null;
  facePlayerUntil: number;
  reactionPause: { x: number; z: number; until: number } | null;
  greetedAt: number;
  placed: boolean;
  /** Where they stood when the last frame was drawn. */
  last: { x: number; z: number; pose: "stand" | "sit" };
  /** Talking with this viewer: stays put. */
  held: { x: number; z: number; pose: "stand" | "sit" } | null;
  /** Just let go: blends from here back onto the schedule. */
  rejoin: {
    x: number;
    z: number;
    from: number;
    route?: { x: number; z: number }[];
  } | null;
}

/** How long a resident takes to walk back into their day after a talk. */

/** The schedule's clock: wall time, so every visitor sees the same plaza. */

export function createResidents(
  builder: WorldBuilder,
  labelHost: HTMLElement,
  cast: readonly ResidentSpec[],
  schedule: Schedule,
  grid?: Grid,
  openAir?: OpenAirRuntime,
): Residents {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
  });
  const seenObjectActions = new Map<
    string,
    { at: number; owner: string | null }
  >();
  const reactionSpeech = new Map<string, number>();
  const escortRoutes = new Map<string, { x: number; z: number }[]>();
  const live: Live[] = cast.map((spec) => {
    const look = LOOKS[spec.species];
    const group = builder.group();
    group.name = `resident:${spec.id}`;
    const body = new THREE.Mesh(
      merged(bodyGeometry(look, spec.shirt)),
      material,
    );
    body.castShadow = true;
    body.receiveShadow = true;
    builder.track(body, group);
    const head = new THREE.Mesh(merged(headGeometry(look)), material);
    head.position.y = NECK;
    head.castShadow = true;
    builder.track(head, group);
    const tool = builder.box(
      0.07,
      0.45,
      0.07,
      spec.id === "koala" ? "#79954f" : "#c99a63",
      -0.32,
      0.4,
      0.2,
      group,
    );
    tool.visible = false;
    const label = document.createElement("div");
    label.className = "pg-label";
    const bubble = document.createElement("div");
    bubble.className = "pg-speech";
    bubble.style.display = "none";
    label.append(bubble);
    labelHost.append(label);
    return {
      spec,
      group,
      head,
      tool,
      activitySeen: 0,
      leaseKey: null,
      leaseActive: false,
      escortDistance: 0,
      lastUpdate: 0,
      bubble,
      label,
      labelPosition: new THREE.Vector3(),
      anchor: new THREE.Vector3(),
      collider: circle(0, 0, 0.35),
      yaw: 0,
      headYaw: 0,
      saying: null,
      facePlayerUntil: 0,
      reactionPause: null,
      greetedAt: -Infinity,
      placed: false,
      last: { x: 0, z: 0, pose: "stand" },
      held: null,
      rejoin: null,
    };
  });

  // Talking to a resident is the page's business (a conversation), so these
  // carry no local `activate`.
  const interactables: Interactable[] = live.map((resident) => ({
    kind: "mascot",
    id: resident.spec.id,
    title: resident.spec.name,
    anchor: resident.anchor,
  }));

  const turn = (from: number, to: number, rate: number) => {
    const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    return from + delta * rate;
  };

  return {
    colliders: live.map((resident) => resident.collider),
    interactables,
    labels: live.map((resident) => ({
      element: resident.label,
      position: resident.labelPosition,
    })),

    update(eye, reducedMotion, others = []) {
      const seconds = (openAir?.now() ?? Date.now()) / 1000;
      const nowMs = seconds * 1000;
      const states = live.map((resident, index) => {
        const state = { ...schedule.stateAt(index, seconds) };
        if (resident.reactionPause && nowMs >= resident.reactionPause.until) {
          resident.rejoin = {
            x: resident.reactionPause.x,
            z: resident.reactionPause.z,
            from: nowMs,
          };
          resident.reactionPause = null;
        }
        if (resident.reactionPause && !resident.held) {
          state.x = resident.reactionPause.x;
          state.z = resident.reactionPause.z;
          state.moving = false;
        } else if (resident.held) {
          state.x = resident.held.x;
          state.z = resident.held.z;
          state.pose = resident.held.pose;
          state.moving = false;
        } else if (resident.rejoin) {
          const join = resident.rejoin;
          if (grid && !join.route)
            join.route = [
              { x: join.x, z: join.z },
              ...findPath(grid, join, state),
            ];
          const route = join.route ?? [
            { x: join.x, z: join.z },
            { x: state.x, z: state.z },
          ];
          let distance = ((nowMs - join.from) / 1000) * 1.8,
            arrived = true;
          for (let j = 1; j < route.length; j++) {
            const a = route[j - 1],
              b = route[j],
              length = Math.hypot(b.x - a.x, b.z - a.z);
            if (distance < length) {
              state.x = a.x + ((b.x - a.x) * distance) / length;
              state.z = a.z + ((b.z - a.z) * distance) / length;
              state.yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z));
              state.pose = "stand";
              state.moving = true;
              arrived = false;
              break;
            }
            distance -= length;
          }
          if (arrived) {
            const end = route[route.length - 1] ?? join;
            if (Math.hypot(end.x - state.x, end.z - state.z) > 1) {
              resident.rejoin = { x: end.x, z: end.z, from: nowMs };
              state.x = end.x;
              state.z = end.z;
              state.moving = false;
            } else resident.rejoin = null;
          }
        }
        const shared = openAir?.state();
        const lease =
          shared && activeLease(shared, resident.spec.id as ResidentId, nowMs);
        if (lease) {
          state.x = lease.x;
          state.z = lease.z;
          state.moving = false;
          state.pose = "stand";
          if (lease.goal && grid) {
            const goal = OPEN_AIR_PLACES.find((p) => p.id === lease.goal)!;
            const routeKey = `${resident.spec.id}:${lease.startedAt ?? lease.at}:${lease.goal}`;
            let route = escortRoutes.get(routeKey);
            if (!route) {
              route = [
                { x: lease.x, z: lease.z },
                ...findPath(
                  grid,
                  { x: lease.x, z: lease.z },
                  { x: goal.x, z: goal.z },
                ),
              ];
              escortRoutes.set(routeKey, route);
              if (escortRoutes.size > 30)
                escortRoutes.delete(escortRoutes.keys().next().value!);
            }
            const owner = openAir?.peer(lease.owner);
            if (resident.leaseKey !== routeKey) {
              resident.leaseKey = routeKey;
              resident.escortDistance = 0;
              resident.lastUpdate = nowMs;
            }
            const delta = Math.min(
              0.1,
              Math.max(0, (nowMs - resident.lastUpdate) / 1000),
            );
            resident.lastUpdate = nowMs;
            let distance = resident.escortDistance;
            const close =
              owner &&
              Math.hypot(resident.last.x - owner.x, resident.last.z - owner.z) <
                4;
            if (close) distance += delta * 1.8;
            resident.escortDistance = distance;
            for (let j = 1; j < route.length; j++) {
              const a = route[j - 1],
                b = route[j],
                length = Math.hypot(b.x - a.x, b.z - a.z);
              if (distance < length) {
                state.x = a.x + ((b.x - a.x) * distance) / length;
                state.z = a.z + ((b.z - a.z) * distance) / length;
                state.yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z));
                state.moving = !!close;
                break;
              }
              distance -= length;
              state.x = b.x;
              state.z = b.z;
            }
          }
        }
        if (!lease && resident.leaseActive) {
          resident.rejoin = {
            x: resident.last.x,
            z: resident.last.z,
            from: nowMs,
          };
          resident.leaseKey = null;
          state.x = resident.last.x;
          state.z = resident.last.z;
          state.moving = false;
        }
        if (!lease && !resident.held && openAir) {
          if (resident.spec.id === "panda" && !shared?.objects["wood-0"]) {
            const work = driftwoodWork(nowMs);
            if (work.active) {
              state.x = work.x;
              state.z = work.z;
              state.yaw = work.yaw;
              state.moving = work.carrying || (work.z > -30 && work.z < 16);
            }
          }
          if (resident.spec.id === "dog") {
            const ball = ITEMS.filter((i) => i.kind === "ball")
              .map((item) => ({ item, saved: shared?.objects[item.id] }))
              .filter(
                (v) =>
                  v.saved &&
                  !v.saved.owner &&
                  Math.hypot(v.saved.vx, v.saved.vz) > 0.15 &&
                  nowMs - v.saved.at < 8000,
              )
              .sort((a, b) => b.saved!.at - a.saved!.at)[0];
            if (ball?.saved && grid) {
              const p = itemPosition(ball.item, ball.saved, nowMs, shared),
                start = schedule.stateAt(index, ball.saved.at / 1000),
                key = `chase:${ball.saved.at}:${ball.item.id}`;
              let route = escortRoutes.get(key);
              if (!route) {
                route = [start, ...findPath(grid, start, p), p];
                escortRoutes.set(key, route);
              }
              let distance = Math.max(0, (nowMs - ball.saved.at) / 1000) * 2.5;
              for (let j = 1; j < route.length; j++) {
                const a = route[j - 1],
                  b = route[j],
                  length = Math.hypot(b.x - a.x, b.z - a.z);
                if (distance < length) {
                  state.x = a.x + ((b.x - a.x) * distance) / length;
                  state.z = a.z + ((b.z - a.z) * distance) / length;
                  state.yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z));
                  state.moving = true;
                  break;
                }
                distance -= length;
                state.x = b.x;
                state.z = b.z;
                state.moving = false;
              }
            }
          }
        }
        resident.leaseActive = !!lease;
        return state;
      });
      // Residents acknowledge world actions where they actually happened.
      if (openAir) {
        for (const item of ITEMS) {
          const saved = openAir.state().objects[item.id];
          const previous = seenObjectActions.get(item.id);
          if (!saved || previous?.at === saved.at) continue;
          seenObjectActions.set(item.id, { at: saved.at, owner: saved.owner });
          if (saved.owner && previous?.owner === saved.owner) continue;
          if (nowMs - saved.at > 4000) continue;
          const p = itemPosition(item, saved, nowMs, openAir.state());
          const nearest = live
            .map((r, i) => ({
              r,
              d: Math.hypot(states[i].x - p.x, states[i].z - p.z),
            }))
            .filter(
              (v) =>
                v.d < 6 &&
                !activeLease(openAir.state(), v.r.spec.id as ResidentId, nowMs),
            )
            .sort((a, b) => a.d - b.d)[0]?.r;
          if (nearest) {
            nearest.reactionPause = {
              x: nearest.last.x,
              z: nearest.last.z,
              until: nowMs + 1200,
            };
            if (
              nowMs - (reactionSpeech.get(nearest.spec.id) ?? -Infinity) >
              8000
            ) {
              reactionSpeech.set(nearest.spec.id, nowMs);
              nearest.saying = {
                text: saved.owner
                  ? `You found a ${item.kind}. Try placing or throwing it.`
                  : terrainHeight(p.x, p.z) < -0.8
                    ? item.kind === "wood" ||
                      item.kind === "leaf" ||
                      item.kind === "ball"
                      ? "Look — it floats!"
                      : "Nice splash!"
                    : "That makes a lovely arrangement.",
                until: nowMs + 3500,
              };
            }
            nearest.facePlayerUntil = nowMs + 3500;
          }
        }
      }
      // Keep bodies apart: residents passing each other step aside, nobody
      // stands inside Nagi. Seated residents and Nagi do not move.
      const points = [
        ...states.map((state) => ({ x: state.x, z: state.z })),
        ...others.map((o) => ({ ...o })),
      ];
      separate(points, [
        ...states.map(
          (state, index) =>
            state.pose === "sit" ||
            live[index].held !== null ||
            !!(
              openAir &&
              activeLease(
                openAir.state(),
                live[index].spec.id as ResidentId,
                nowMs,
              )
            ),
        ),
        ...others.map(() => true),
      ]);
      states.forEach((state, index) => {
        state.x = points[index].x;
        state.z = points[index].z;
      });
      // Ambient chatter is a background murmur: only the few nearest
      // residents may show it, so bubbles never pile up across the plaza.
      const distances = states.map((state) =>
        eye ? Math.hypot(eye.x - state.x, eye.z - state.z) : Infinity,
      );
      const ambientAllowed = new Set(
        distances
          .map((distance, index) => [distance, index] as const)
          .filter(([distance]) => distance < 10)
          .sort((a, b) => a[0] - b[0])
          .slice(0, 3)
          .map(([, index]) => index),
      );
      const spokenLines = new Set<string>();
      live.forEach((resident, index) => {
        const state = states[index];
        const toPlayer = eye
          ? Math.hypot(eye.x - state.x, eye.z - state.z)
          : Infinity;

        // ---- who are they talking to? ----
        let partner: number | null = null;
        if (!state.moving && state.spot.group) {
          partner = states.findIndex(
            (other, j) =>
              j !== index &&
              !other.moving &&
              other.spot.group === state.spot.group &&
              Math.hypot(other.x - state.x, other.z - state.z) < 3.5,
          );
          if (partner < 0) partner = null;
        }
        // Greet the visitor who walks up, once in a while.
        if (resident.held) {
          resident.facePlayerUntil = nowMs + 1500;
        }
        if (
          eye &&
          !resident.held &&
          toPlayer < 3.2 &&
          nowMs - resident.greetedAt > 45000 &&
          !resident.saying
        ) {
          const greet = LINES[resident.spec.personality].greet;
          resident.greetedAt = nowMs;
          resident.saying = {
            text: greet[
              Math.floor(hash01(index, Math.floor(seconds)) * greet.length)
            ],
            until: nowMs + 3800,
          };
          resident.facePlayerUntil = nowMs + 4500;
        }
        if (resident.saying && resident.saying.until < nowMs)
          resident.saying = null;

        // ---- what they say (local override > conversation > musing) ----
        let line: string | null = resident.saying?.text ?? null;
        // In a conversation the dialog speaks for them, not a bubble.
        const nearby = ambientAllowed.has(index) && !resident.held;
        if (!line && nearby && partner !== null && state.stayed > 1.5) {
          const turnIndex = Math.floor(seconds / 4.5);
          const speaker =
            turnIndex % 2 === 0
              ? Math.min(index, partner)
              : Math.max(index, partner);
          const groupSeed =
            state.spot.group!.length * 97 + Math.min(index, partner);
          if (speaker === index && seconds - turnIndex * 4.5 < 3.6) {
            line =
              CHATTER[
                Math.floor(hash01(groupSeed, turnIndex) * CHATTER.length)
              ];
          }
        } else if (!line && nearby && !state.moving && state.stayed > 3) {
          const window = Math.floor(seconds / 25);
          if (hash01(index * 17, window) < 0.3 && seconds - window * 25 < 4) {
            const muse = LINES[resident.spec.personality].muse;
            line = muse[Math.floor(hash01(index, window) * muse.length)];
          }
        }
        if (line && !spokenLines.has(line) && nearby) {
          spokenLines.add(line);
          if (resident.bubble.textContent !== line)
            resident.bubble.textContent = line;
          resident.bubble.style.display = "block";
        } else {
          resident.bubble.style.display = "none";
        }

        // ---- facing ----
        let bodyYaw = state.yaw;
        let lookAt: number | null = null;
        const lease =
          openAir &&
          activeLease(openAir.state(), resident.spec.id as ResidentId, nowMs);
        const visitor = lease ? openAir?.peer(lease.owner) : eye;
        if (visitor && lease && !state.moving) {
          lookAt = Math.atan2(-(visitor.x - state.x), -(visitor.z - state.z));
          bodyYaw = lookAt;
        }
        if (eye && !lease && nowMs < resident.facePlayerUntil) {
          lookAt = Math.atan2(-(eye.x - state.x), -(eye.z - state.z));
          if (!state.moving && state.pose === "stand") bodyYaw = lookAt;
        } else if (!lease && partner !== null) {
          lookAt = Math.atan2(
            -(states[partner].x - state.x),
            -(states[partner].z - state.z),
          );
        } else if (!lease && eye && toPlayer < 4) {
          lookAt = Math.atan2(-(eye.x - state.x), -(eye.z - state.z));
        }
        if (
          resident.spec.id === "owl" &&
          !lease &&
          !state.moving &&
          state.spot.id === "job-shells" &&
          openAir &&
          !Object.values(openAir.state().observations).some((observations) =>
            observations.includes("keepsake"),
          )
        ) {
          const shell = ITEMS.find((item) => item.id === "keepsake")!;
          const p = itemPosition(
            shell,
            openAir.state().objects[shell.id],
            nowMs,
            openAir.state(),
          );
          if (!p.held) {
            lookAt = Math.atan2(-(p.x - state.x), -(p.z - state.z));
            bodyYaw = lookAt;
          }
        }
        if (!resident.placed) {
          resident.yaw = bodyYaw;
          resident.placed = true;
        }
        resident.yaw = turn(resident.yaw, bodyYaw, reducedMotion ? 1 : 0.12);
        // Model faces +Z; camera yaw 0 looks −Z.
        resident.group.rotation.y = resident.yaw + Math.PI;
        const headTarget =
          lookAt === null
            ? 0
            : Math.max(
                -1.1,
                Math.min(
                  1.1,
                  Math.atan2(
                    Math.sin(lookAt - resident.yaw),
                    Math.cos(lookAt - resident.yaw),
                  ),
                ),
              );
        resident.headYaw +=
          (headTarget - resident.headYaw) * (reducedMotion ? 1 : 0.1);
        resident.head.rotation.y = resident.headYaw;

        // ---- body ----
        const t = seconds + index * 0.37;
        let y =
          (state.pose === "sit" ? 0.27 : 0) +
          landmarkGround(state.x, state.z, terrainHeight(state.x, state.z));
        resident.group.rotation.z = 0;
        if (!reducedMotion) {
          if (state.moving) {
            y += Math.abs(Math.sin(t * 8.5)) * 0.05;
            resident.group.rotation.z = Math.sin(t * 8.5) * 0.07;
          } else {
            y += Math.sin(t * 1.6) * 0.006;
          }
          if (line && !state.moving)
            resident.head.rotation.x = Math.sin(t * 9) * 0.04;
          else resident.head.rotation.x = 0;
        }
        const phase = worldMoment(nowMs);
        const escortGoal =
          lease?.goal && OPEN_AIR_PLACES.find((p) => p.id === lease.goal);
        const arrived =
          escortGoal &&
          Math.hypot(state.x - escortGoal.x, state.z - escortGoal.z) <
            escortGoal.radius;
        const activity = arrived
          ? escortGoal.id === "pools"
            ? resident.spec.id === "owl"
              ? "job-shells"
              : "job-crabs"
            : escortGoal.id === "pier"
              ? "job-driftwood"
              : escortGoal.id === "lookout"
                ? "job-exercise"
                : "job-rest"
          : state.spot.id;
        if (lease && !state.moving && !reducedMotion)
          resident.head.rotation.x = arrived
            ? escortGoal?.id === "camp"
              ? -0.35
              : 0.2
            : Math.sin(t * 2) * 0.06;
        resident.tool.visible =
          activity.startsWith("job-") &&
          !state.moving &&
          !lease &&
          !["cat", "penguin", "rabbit", "dog"].includes(resident.spec.id);
        if (resident.tool.visible && !reducedMotion)
          resident.tool.rotation.x = Math.sin(t * 2) * 0.25;
        if (
          !state.moving &&
          activity.startsWith("job-") &&
          !lease &&
          nearby &&
          !line &&
          nowMs - resident.activitySeen > 25000
        ) {
          const words: Record<string, string> = {
            "job-rest": "The shade is a good place to slow down.",
            "job-ball": "There’s a ball nearby. Try throwing it!",
            "job-driftwood": "Wood floats. Let’s try it at the pier.",
            "job-apps":
              "Shared apps appear here. Try one and tell us about it.",
            "job-dance": "A little dance by the waves!",
            "job-exercise": "Steps or a jump — both lead up the dune.",
            "job-repair": "This roof keeps the rain off.",
            "job-flowers": "The leaves move with the sea breeze.",
            "job-crabs": "Crouch to watch the crabs without startling them.",
            "job-shells": `I can see a ${(openAir ? shellArrangement(openAir.state(), nowMs) : "shell arrangement").replace("shell ", "")} of shells. Try another shape.`,
          };
          resident.activitySeen = nowMs;
          resident.saying = {
            text: words[activity] ?? "Let’s explore.",
            until: nowMs + 3800,
          };
        }
        if (
          !state.moving &&
          activity.startsWith("job-") &&
          (!lease || arrived) &&
          !reducedMotion
        ) {
          switch (activity) {
            case "job-rest":
              resident.head.rotation.x = 0.18;
              break;
            case "job-ball":
              resident.head.rotation.x = 0.1 + Math.sin(t * 2) * 0.12;
              resident.group.rotation.z = Math.sin(t * 2) * 0.08;
              break;
            case "job-driftwood":
              resident.group.rotation.z = Math.sin(t) * 0.06;
              resident.head.rotation.x = 0.16;
              break;
            case "job-apps":
              resident.head.rotation.y += Math.sin(t * 0.8) * 0.2;
              break;
            case "job-dance":
              y += Math.abs(Math.sin(t * 3)) * 0.09;
              resident.group.rotation.z = Math.sin(t * 3) * 0.18;
              break;
            case "job-exercise":
              y += Math.max(0, Math.sin(t * 2.2)) * 0.35;
              resident.group.rotation.z = Math.sin(t) * 0.04;
              break;
            case "job-repair":
              resident.head.rotation.x = 0.15 + Math.sin(t * 4) * 0.06;
              resident.tool.rotation.x = Math.sin(t * 4) * 0.45;
              break;
            case "job-flowers":
              resident.head.rotation.x = 0.25;
              y -= 0.1;
              resident.tool.rotation.z = Math.sin(t) * 0.15;
              break;
            case "job-crabs":
              resident.head.rotation.x = 0.32;
              y -= 0.14;
              break;
            case "job-shells":
              resident.head.rotation.y += Math.sin(t * 0.7) * 0.35;
              resident.head.rotation.x = 0.22;
              resident.tool.rotation.x = Math.sin(t * 1.5) * 0.18;
              break;
          }
        }
        if (!state.moving && !resident.held && !reducedMotion) {
          if (
            (resident.spec.id === "cat" && state.pose === "sit") ||
            phase.phase === "night"
          )
            resident.head.rotation.x = 0.18;
          else if (
            activity.startsWith("garden") ||
            activity.startsWith("shore")
          ) {
            resident.head.rotation.x = 0.2;
            y -= 0.08;
          }
          if (
            nowMs < resident.facePlayerUntil &&
            resident.saying?.text.includes("👋")
          )
            resident.group.rotation.z = Math.sin(t * 7) * 0.12;
          else if (nowMs < resident.facePlayerUntil && resident.saying)
            resident.head.rotation.x = Math.sin(t * 5) * 0.12;
        }
        resident.group.position.set(state.x, y, state.z);
        resident.last = { x: state.x, z: state.z, pose: state.pose };
        resident.anchor.set(state.x, y + NECK + HEAD, state.z);
        resident.labelPosition.set(state.x, y + 1.25, state.z);

        // ---- body you bump into (not while sitting, never trapping you) ----
        resident.collider.x = state.x;
        resident.collider.z = state.z;
        resident.collider.r = state.pose === "sit" ? 0 : 0.35;
      });
    },

    react(id, emoji) {
      const resident = live.find((entry) => entry.spec.id === id);
      if (!resident) return;
      const text = residentReaction(resident.spec.personality, emoji);
      if (!text) return;
      resident.saying = { text, until: (openAir?.now() ?? Date.now()) + 3500 };
      if (!resident.held) {
        resident.reactionPause = {
          x: resident.last.x,
          z: resident.last.z,
          until: (openAir?.now() ?? Date.now()) + 3500,
        };
      }
      resident.facePlayerUntil = (openAir?.now() ?? Date.now()) + 4000;
    },

    hold(id, on) {
      const resident = live.find((entry) => entry.spec.id === id);
      if (!resident) return;
      if (on) {
        resident.rejoin = null;
        resident.reactionPause = null;
        resident.held = { ...resident.last };
        return;
      }
      if (!resident.held) return;
      resident.rejoin = {
        x: resident.held.x,
        z: resident.held.z,
        from: Date.now(),
      };
      resident.held = null;
    },

    dispose() {
      for (const resident of live) resident.label.remove();
    },
  };
}
