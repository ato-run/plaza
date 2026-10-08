/**
 * `startWorld()` — the seam between React, the transport, and the engine.
 *
 * Orchestration only. The renderer, camera, input and loop live in
 * `engine.ts`; the places live in `worlds/`; this file wires them to the
 * outside: it reports the local transform and reactions OUT, and is handed
 * remote presence and the server's Software cards IN. It owns no socket and
 * no fetch.
 *
 * This boundary does not choose how state is shared. It reports application
 * operations and accepts projected presence; the page binds those ports to
 * Ato's authorized Runner path when hosted in an Activity. Local persistence,
 * transport, ordering and Actor authority therefore remain outside the 3D
 * engine instead of being reimplemented here.
 */
import * as THREE from "three";

import {
  animateAvatar,
  createAvatar,
  disposeAvatar,
  labelHeightForPose,
  personAnchorHeightForPose,
  receiveTransform,
  type Avatar,
} from "./avatar";
import { createEngine, type Engine, type LookMode } from "./engine";
import {
  addExhibit,
  EXHIBIT_OBSTACLE_RADIUS,
  type Exhibit,
  type ExhibitCard,
} from "./exhibit";
import { resolveTarget, targetKey, type WorldTarget } from "./interaction";
import { circle, type Collider } from "./collision";
import { DEFAULT_WORLD_ID, type Pose, type WorldId } from "./types";
import { resolveOpenableWorld, worldDefinition } from "./worlds";
import type { MovementState } from "./worldMath";
import { reportEyeY } from "./worldMath";
import type { PresenceMember } from "../presenceStore";

export type { ExhibitCard } from "./exhibit";
export type { WorldTarget } from "./interaction";

export interface WorldTransformReport {
  world_id: WorldId;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  movement: MovementState;
  pose: Pose;
}

export interface WorldHooks {
  onPointerLockChange(engaged: boolean, mode: LookMode): void;
  onTargetChange(target: WorldTarget | null): void;
  /** ~12Hz, already throttled. */
  onTransform(transform: WorldTransformReport): void;
  onRequestChat(): void;
  onRequestMenu?(): void;
  onInteract(target: WorldTarget): void;
  onFaceReaction(targetPrincipalId: string, emoji: string): void;
  onWorldChange(worldId: WorldId): void;
  onError(message: string): void;
}

export interface WorldHandle {
  dispose(): void;
  requestPointerLock(): void;
  setPaused(paused: boolean): void;
  setPresence(members: Iterable<PresenceMember>, selfPrincipalId: string | null): void;
  setExhibits(cards: readonly ExhibitCard[]): void;
  /** Fire a reaction at whatever is currently centred. */
  reactAtTarget(emoji: string): void;
  /** Interact with whatever is currently centred. */
  interactWithTarget(): void;
  /** Have the World's guide say something (no-op where there is none). */
  guideSay(text: string): void;
  /** Keep a resident in place, facing the viewer, while they talk (no-op where there are none). */
  holdNeighbor(id: string, on: boolean): void;
  /** Mark a destination on the ground with a light column; null clears it. */
  setWaypoint(point: { x: number; z: number } | null): void;
  /** Where the viewer is and which way they face — for the guide's lessons. */
  viewerPose(): { x: number; y: number; z: number; yaw: number; pitch: number };
  /** People currently rendered near the viewer (within `radius` metres). */
  peopleNear(radius: number): number;
  /** Mobile joystick, normalized to [-1, 1]. */
  setJoystick(x: number, y: number): void;
  /** Touch jump button. Keyboard uses Space. */
  jump(): void;
  /** Touch crouch toggle. Keyboard holds C / Control. */
  setCrouching(crouching: boolean): void;
  /** Lighting mood for this viewer only; see `WorldEnvironment.timesOfDay`. */
  setTimeOfDay(id: string | null): void;
  /** Move to another World. Unavailable ids fall back to the default. */
  enterWorld(worldId: WorldId): void;
  currentWorld(): WorldId;
}

const FACE_REACTION_EMOJI = new Set(["👋", "❤️", "😂", "👍"]);

/** The interactable id behind a target, for Worlds that own its behaviour. */
function targetLocalId(target: WorldTarget): string {
  if (target.kind === "mascot") return target.mascotId;
  if (target.kind === "seat") return target.seatId;
  return "";
}

export function startWorld(host: HTMLDivElement, hooks: WorldHooks): WorldHandle {
  const avatars = new Map<string, Avatar>();
  const exhibits: Exhibit[] = [];
  let exhibitColliders: Collider[] = [];
  let selfPrincipalId: string | null = null;
  let currentTarget: WorldTarget | null = null;
  let lastTargetKey = "";
  let worldId: WorldId = DEFAULT_WORLD_ID;
  let exhibitRoot: THREE.Group | null = null;
  let cards: readonly ExhibitCard[] = [];
  // Seats own the pose when active (future): a seated reporter is rendered by
  // pose, not by position. Until a World offers one, the engine's locomotion
  // pose (stand/crouch) is the report.

  const engine: Engine = createEngine({
    host,
    onPointerLockChange: hooks.onPointerLockChange,
    onRequestChat: hooks.onRequestChat,
    onRequestMenu: () => hooks.onRequestMenu?.(),
    onInteract: () => handle.interactWithTarget(),
    onReaction: (index) =>
      handle.reactAtTarget(["👋", "❤️", "😂", "👍"][index]),
    onError: hooks.onError,
  });

  /** The World's own local behaviour for a target, if it has any. */
  function activateLocal(id: string): boolean {
    const found = engine.world?.interactables.find((item) => item.id === id);
    if (!found?.activate) return false;
    found.activate();
    return true;
  }

  function rebuildExhibits(): void {
    for (const exhibit of exhibits) exhibit.dispose();
    exhibits.length = 0;
    exhibitColliders = [];

    const runtime = engine.world;
    const slots = runtime?.softwareSlots ?? [];
    if (!runtime || slots.length === 0) return;

    if (!exhibitRoot) {
      exhibitRoot = new THREE.Group();
      exhibitRoot.name = "exhibits";
    }
    // Re-parent into the CURRENT World's scene graph, so a World switch takes
    // the exhibits with it rather than leaving plinths floating in the next
    // place.
    engine.scene.add(exhibitRoot);

    cards.slice(0, slots.length).forEach((card, index) => {
      const slot = slots[index];
      const exhibit = addExhibit(exhibitRoot as THREE.Group, slot, index, card);
      exhibits.push(exhibit);
      exhibitColliders.push(circle(slot.x, slot.z, EXHIBIT_OBSTACLE_RADIUS));
    });
    // Colliders are the World's plus the exhibits standing in its slots.
    runtime.colliders = runtime.colliders
      .filter((collider) => !exhibitColliders.includes(collider))
      .concat(exhibitColliders);
  }

  function mountWorld(next: WorldId): void {
    const definition = resolveOpenableWorld(next);
    clearWaypoint();
    for (const avatar of avatars.values()) disposeAvatar(engine.scene, avatar);
    avatars.clear();
    for (const exhibit of exhibits) exhibit.dispose();
    exhibits.length = 0;
    if (exhibitRoot) {
      exhibitRoot.removeFromParent();
      exhibitRoot = null;
    }
    engine.mount(definition);
    worldId = definition.id;
    currentTarget = null;
    lastTargetKey = "";
    rebuildExhibits();
    hooks.onWorldChange(worldId);
  }

  engine.onFrame(({ now, dt, movement, pose, forward }) => {
    pulseWaypoint(now);
    if (engine.cadenceDue(now)) {
      hooks.onTransform({
        world_id: worldId,
        x: engine.camera.position.x,
        // Stand-based `y` (see `reportEyeY`): pose-unaware clients keep the
        // right feet, and the arc of a jump still reads in the lift.
        y: reportEyeY(engine.camera.position.y, pose),
        z: engine.camera.position.z,
        yaw: engine.camera.rotation.y,
        pitch: engine.camera.rotation.x,
        movement,
        pose,
      });
    }

    for (const avatar of avatars.values()) {
      animateAvatar(avatar, now, dt, engine.reducedMotion);
    }

    const people = [...avatars.values()].map((avatar) => ({
      principalId: avatar.principalId,
      name: avatar.nameTag.textContent ?? "",
      position: {
        x: avatar.group.position.x,
        y: avatar.group.position.y + personAnchorHeightForPose(avatar.pose),
        z: avatar.group.position.z,
      },
    }));
    currentTarget = resolveTarget(
      engine.camera.position,
      forward,
      people,
      engine.world?.interactables ?? [],
    );
    const key = targetKey(currentTarget);
    if (key !== lastTargetKey) {
      lastTargetKey = key;
      hooks.onTargetChange(currentTarget);
    }

    // Project each label to screen space: people, and the World's own
    // (mascots). Kept inside the view so a speech bubble near an edge is
    // shifted in rather than cut off.
    for (const avatar of avatars.values()) {
      const anchor = avatar.group.position.clone();
      anchor.y += labelHeightForPose(avatar.pose);
      placeLabel(avatar.label, anchor);
    }
    for (const label of engine.world?.labels ?? []) {
      placeLabel(label.element, label.position);
    }
  });

  function placeLabel(element: HTMLElement, anchor: THREE.Vector3): void {
    const placed = engine.project(anchor);
    const style = element.style;
    if (!placed) {
      style.display = "none";
      return;
    }
    style.display = "flex";
    const margin = 8;
    const halfWidth = element.offsetWidth / 2;
    const width = host.clientWidth;
    const left =
      halfWidth * 2 + margin * 2 >= width
        ? width / 2
        : Math.min(Math.max(placed.left, halfWidth + margin), width - halfWidth - margin);
    // The label hangs above its anchor (translate -100%); keep its top edge in.
    const top = Math.max(placed.top, element.offsetHeight + margin);
    style.left = `${left}px`;
    style.top = `${top}px`;
    // Near speakers read clearly; distant ones fade rather than clutter.
    style.opacity = String(
      placed.distance < 7 ? 1 : Math.max(0.15, 1 - (placed.distance - 7) / 13),
    );
  }

  // ---- waypoint: a soft light column and a ring where the guide is taking you
  let waypoint: THREE.Group | null = null;
  const waypointParts: { dispose(): void }[] = [];
  function clearWaypoint(): void {
    waypoint?.removeFromParent();
    waypoint = null;
    for (const part of waypointParts.splice(0)) part.dispose();
  }
  function placeWaypoint(point: { x: number; z: number }): void {
    clearWaypoint();
    const group = new THREE.Group();
    group.name = "waypoint";
    const ground = engine.world?.groundY?.(point.x, point.z) ?? 0;
    group.position.set(point.x, ground, point.z);
    const beamGeometry = new THREE.CylinderGeometry(0.45, 0.6, 9, 32, 1, true);
    beamGeometry.translate(0, 4.5, 0);
    const beamMaterial = new THREE.MeshBasicMaterial({
      color: "#ffe8b0",
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const ringGeometry = new THREE.RingGeometry(0.75, 0.95, 48);
    ringGeometry.rotateX(-Math.PI / 2);
    ringGeometry.translate(0, 0.04, 0);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: "#fff3cf",
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const beam = new THREE.Mesh(beamGeometry, beamMaterial);
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    group.add(beam, ring);
    waypointParts.push(beamGeometry, beamMaterial, ringGeometry, ringMaterial);
    engine.scene.add(group);
    waypoint = group;
  }
  function pulseWaypoint(now: number): void {
    if (!waypoint || engine.reducedMotion) return;
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.004);
    const ring = waypoint.children[1] as THREE.Mesh;
    ring.scale.setScalar(1 + pulse * 0.25);
    (ring.material as THREE.MeshBasicMaterial).opacity = 0.55 + pulse * 0.35;
  }

  const handle: WorldHandle = {
    dispose() {
      clearWaypoint();
      for (const avatar of avatars.values()) disposeAvatar(engine.scene, avatar);
      avatars.clear();
      for (const exhibit of exhibits) exhibit.dispose();
      exhibits.length = 0;
      exhibitRoot?.removeFromParent();
      exhibitRoot = null;
      engine.dispose();
    },

    requestPointerLock: () => engine.requestPointerLock(),
    setPaused: (paused) => engine.setPaused(paused),
    setJoystick: (x, y) => engine.setJoystick(x, y),
    jump: () => engine.jump(),
    setCrouching: (crouching) => engine.setCrouching(crouching),
    setTimeOfDay: (id) => engine.setTimeOfDay(id),
    currentWorld: () => worldId,

    enterWorld(next) {
      if (next === worldId) return;
      mountWorld(next);
    },

    setPresence(members, selfId) {
      selfPrincipalId = selfId;
      const seen = new Set<string>();
      for (const member of members) {
        // The local player is first-person: never draw their own body.
        if (selfPrincipalId && member.principal_id === selfPrincipalId) continue;
        seen.add(member.principal_id);
        let avatar = avatars.get(member.principal_id);
        if (!avatar) {
          avatar = createAvatar(
            engine.scene,
            host,
            member.principal_id,
            member.display_name,
          );
          avatars.set(member.principal_id, avatar);
        }
        const label = member.animal_emoji
          ? `${member.animal_emoji} ${member.display_name}`
          : member.display_name;
        if (avatar.nameTag.textContent !== label) avatar.nameTag.textContent = label;
        if (member.transform) receiveTransform(avatar, member.transform);
        avatar.bubble.textContent = member.speech?.text ?? "";
        avatar.bubble.style.display = member.speech ? "block" : "none";
        avatar.reaction.textContent = member.reaction?.emoji ?? "";
        avatar.reaction.style.display = member.reaction ? "block" : "none";
      }
      for (const [id, avatar] of avatars) {
        if (seen.has(id)) continue;
        disposeAvatar(engine.scene, avatar);
        avatars.delete(id);
      }
    },

    setExhibits(next) {
      cards = next;
      rebuildExhibits();
    },

    guideSay(text) {
      engine.world?.guide?.say(text);
    },

    holdNeighbor(id, on) {
      engine.world?.neighbors?.hold(id, on);
    },

    setWaypoint(point) {
      if (point) placeWaypoint(point);
      else clearWaypoint();
    },

    viewerPose() {
      const camera = engine.camera;
      return {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
        yaw: camera.rotation.y,
        pitch: camera.rotation.x,
      };
    },

    peopleNear(radius) {
      let count = 0;
      for (const avatar of avatars.values()) {
        if (avatar.group.position.distanceTo(engine.camera.position) < radius + 1.65) count += 1;
      }
      return count;
    },

    reactAtTarget(emoji) {
      if (!FACE_REACTION_EMOJI.has(emoji)) return;
      if (currentTarget?.kind === "mascot" || currentTarget?.kind === "guide") {
        // A mascot is scenery. Letting a wave "succeed" at one would tell the
        // sender somebody received it when nobody did.
        hooks.onError("Neighbors don't take reactions. Try someone else nearby.");
        return;
      }
      if (currentTarget?.kind !== "person") {
        hooks.onError("Center someone nearby first, then react.");
        return;
      }
      hooks.onFaceReaction(currentTarget.principalId, emoji);
    },

    interactWithTarget() {
      if (!currentTarget) return;
      // A seat is the World's own business — it never reaches the page.
      // Residents (mascots) and the guide open a conversation on the page.
      if (activateLocal(targetLocalId(currentTarget))) return;
      hooks.onInteract(currentTarget);
    },
  };

  mountWorld(worldDefinition(DEFAULT_WORLD_ID).id);
  return handle;
}
