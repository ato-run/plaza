/**
 * What the crosshair is pointing at.
 *
 * Selection is by ANGLE first (see `chooseTarget`), so a far thing you are
 * looking straight at beats a near one at the edge of vision. This module owns
 * the vocabulary — the union of things that can be targeted — and the mapping
 * from a World's contents plus the live roster to that union. It is the only
 * place that knows a mascot and a person are targeted the same way but acted
 * on differently.
 */
import * as THREE from "three";

import { chooseTarget, type TargetCandidate } from "./worldMath";
import type { Interactable } from "./types";

/**
 * A resolved target.
 *
 * People use the shared room lane; residents use private NPC conversations
 * and local reaction acknowledgements. Both share the same targeting controls.
 */
export type WorldTarget =
  | { kind: "person"; principalId: string; name: string }
  | { kind: "mascot"; mascotId: string; name: string }
  | { kind: "guide"; guideId: string; name: string }
  | { kind: "app" | "activity"; ref: string; title: string }
  | { kind: "seat"; seatId: string; title: string }
  | { kind: "object"; objectId: string; title: string };

/** Conversations use Talk/Enter, never the object-interaction shortcut. */
export function isConversationTarget(target: WorldTarget | null): boolean {
  return (
    target?.kind === "person" ||
    target?.kind === "mascot" ||
    target?.kind === "guide"
  );
}

/** A stable identity for a target, for change detection. */
export function targetKey(target: WorldTarget | null): string {
  if (!target) return "";
  switch (target.kind) {
    case "person":
      return `person:${target.principalId}`;
    case "mascot":
      return `mascot:${target.mascotId}`;
    case "guide":
      return `guide:${target.guideId}`;
    case "object":
      return `object:${target.objectId}`;
    case "seat":
      return `seat:${target.seatId}`;
    default:
      return `${target.kind}:${target.ref}`;
  }
}

/** Furniture can contain its own affordance without hiding unrelated targets. */
export function occludesTarget(
  object: THREE.Object3D,
  target: WorldTarget,
  selection?: THREE.Object3D,
): boolean {
  const mesh = object as THREE.Mesh;
  if (!mesh.isMesh || mesh === selection || mesh.userData.nonOccluding)
    return false;
  const key = targetKey(target);
  for (
    let parent: THREE.Object3D | null = mesh;
    parent;
    parent = parent.parent
  ) {
    if (!parent.visible) return false;
    const ownTargets = parent.userData.interactionTargets;
    if (Array.isArray(ownTargets) && ownTargets.includes(key)) return false;
  }
  const materials = Array.isArray(mesh.material)
    ? mesh.material
    : [mesh.material];
  return materials.some(
    (material) =>
      material.opacity > 0.85 &&
      material.depthWrite &&
      material.side !== THREE.BackSide,
  );
}

/**
 * Turn a World's interactables into targeting candidates.
 *
 * A `software` interactable carries the card ref in `meta`, because the World
 * places the plinth but the SERVER decides what is on it — the World must not
 * hold the card data itself or a plinth would go on advertising an App that
 * stopped being public.
 */
export function interactableCandidate(
  interactable: Interactable,
): TargetCandidate<WorldTarget> | null {
  if (interactable.kind === "software") {
    const ref = interactable.meta?.ref;
    const cardKind =
      interactable.meta?.cardKind === "activity" ? "activity" : "app";
    if (!ref) return null;
    return {
      item: { kind: cardKind, ref, title: interactable.title },
      position: interactable.anchor,
      maxDistance: Math.min(interactable.maxDistance ?? 3.4, 3.4),
    };
  }
  if (interactable.kind === "object") {
    return {
      item: {
        kind: "object",
        objectId: interactable.id,
        title: interactable.title,
      },
      position: interactable.anchor,
      maxDistance: interactable.maxDistance ?? 3.2,
      minDot: 0.9,
    };
  }
  if (interactable.kind === "guide") {
    return {
      item: {
        kind: "guide",
        guideId: interactable.id,
        name: interactable.title,
      },
      position: interactable.anchor,
      maxDistance: Math.min(interactable.maxDistance ?? 3.4, 3.4),
    };
  }
  if (interactable.kind === "mascot") {
    return {
      item: {
        kind: "mascot",
        mascotId: interactable.id,
        name: interactable.title,
      },
      position: interactable.anchor,
      maxDistance: Math.min(interactable.maxDistance ?? 3.4, 3.4),
    };
  }
  return {
    item: { kind: "seat", seatId: interactable.id, title: interactable.title },
    position: interactable.anchor,
    maxDistance: Math.min(interactable.maxDistance ?? 3.4, 3.4),
  };
}

export interface PersonCandidate {
  principalId: string;
  name: string;
  position: { x: number; y: number; z: number };
}

/** Pick the single thing being aimed at, people and scenery together. */
export function resolveTarget(
  eye: THREE.Vector3,
  forward: THREE.Vector3,
  people: readonly PersonCandidate[],
  interactables: readonly Interactable[],
  visible: (
    position: TargetCandidate<WorldTarget>["position"],
    target: WorldTarget,
  ) => boolean = () => true,
  preferred?: WorldTarget | null,
): WorldTarget | null {
  const candidates: TargetCandidate<WorldTarget>[] = [];
  for (const person of people) {
    candidates.push({
      item: {
        kind: "person",
        principalId: person.principalId,
        name: person.name,
      },
      position: person.position,
    });
  }
  for (const interactable of interactables) {
    const candidate = interactableCandidate(interactable);
    if (candidate) candidates.push(candidate);
  }
  const eligible = candidates.filter(
    (candidate) =>
      Math.hypot(
        candidate.position.x - eye.x,
        candidate.position.y - eye.y,
        candidate.position.z - eye.z,
      ) <= (candidate.maxDistance ?? 3.4) &&
      visible(candidate.position, candidate.item),
  );
  const previous = eligible.find(
    (candidate) => targetKey(candidate.item) === targetKey(preferred ?? null),
  );
  if (previous && chooseTarget(eye, forward, [previous], 0.91))
    return previous.item;
  return chooseTarget(eye, forward, eligible);
}
