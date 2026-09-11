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
  receiveTransform,
  type Avatar,
} from "./avatar";
import { createEngine, type Engine } from "./engine";
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
  onPointerLockChange(locked: boolean): void;
  onTargetChange(target: WorldTarget | null): void;
  /** ~12Hz, already throttled. */
  onTransform(transform: WorldTransformReport): void;
  onRequestChat(): void;
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
  /** Mobile joystick, normalized to [-1, 1]. */
  setJoystick(x: number, y: number): void;
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
/** How far above a body's feet its name tag floats. */
const LABEL_HEIGHT = 2.12;

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
  let pose: Pose = "stand";

  const engine: Engine = createEngine({
    host,
    onPointerLockChange: hooks.onPointerLockChange,
    onRequestChat: hooks.onRequestChat,
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
    pose = "stand";
    currentTarget = null;
    lastTargetKey = "";
    rebuildExhibits();
    hooks.onWorldChange(worldId);
  }

  engine.onFrame(({ now, dt, movement, forward }) => {
    if (engine.cadenceDue(now)) {
      hooks.onTransform({
        world_id: worldId,
        x: engine.camera.position.x,
        y: engine.camera.position.y,
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
        y: avatar.group.position.y + 1.55,
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

    // Project each label to screen space.
    for (const avatar of avatars.values()) {
      const anchor = avatar.group.position.clone();
      anchor.y += LABEL_HEIGHT;
      const placed = engine.project(anchor);
      const style = avatar.label.style;
      if (!placed) {
        style.display = "none";
        continue;
      }
      style.display = "flex";
      style.left = `${placed.left}px`;
      style.top = `${placed.top}px`;
      // Near speakers read clearly; distant ones fade rather than clutter.
      style.opacity = String(
        placed.distance < 7 ? 1 : Math.max(0.15, 1 - (placed.distance - 7) / 13),
      );
    }
  });

  const handle: WorldHandle = {
    dispose() {
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

    reactAtTarget(emoji) {
      if (!FACE_REACTION_EMOJI.has(emoji)) return;
      if (currentTarget?.kind === "mascot") {
        // A mascot is scenery. Letting a wave "succeed" at one would tell the
        // sender somebody received it when nobody did.
        hooks.onError("その子はガイドだよ。近くの人に向けてみて。");
        return;
      }
      if (currentTarget?.kind !== "person") {
        hooks.onError("近くの人を中央に捉えてからリアクションしてください。");
        return;
      }
      hooks.onFaceReaction(currentTarget.principalId, emoji);
    },

    interactWithTarget() {
      if (!currentTarget) return;
      // A mascot (or a seat) is the World's own business — it never reaches
      // the page, and nothing leaves the browser.
      if (activateLocal(targetLocalId(currentTarget))) return;
      hooks.onInteract(currentTarget);
    },
  };

  mountWorld(worldDefinition(DEFAULT_WORLD_ID).id);
  return handle;
}
