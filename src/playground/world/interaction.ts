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
import type * as THREE from "three";

import { chooseTarget, type TargetCandidate } from "./worldMath";
import type { Interactable } from "./types";

/**
 * A resolved target.
 *
 * `person` and `mascot` look identical through a crosshair and are deliberately
 * distinct here: one is somebody who will see your 👋 arrive, the other is
 * scenery that says a canned line. Collapsing them would let a wave be sent to
 * nobody, with the sender believing it landed.
 */
export type WorldTarget =
  | { kind: "person"; principalId: string; name: string }
  | { kind: "mascot"; mascotId: string; name: string }
  | { kind: "app" | "activity"; ref: string; title: string }
  | { kind: "seat"; seatId: string; title: string };

/** A stable identity for a target, for change detection. */
export function targetKey(target: WorldTarget | null): string {
  if (!target) return "";
  switch (target.kind) {
    case "person":
      return `person:${target.principalId}`;
    case "mascot":
      return `mascot:${target.mascotId}`;
    case "seat":
      return `seat:${target.seatId}`;
    default:
      return `${target.kind}:${target.ref}`;
  }
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
    const cardKind = interactable.meta?.cardKind === "activity" ? "activity" : "app";
    if (!ref) return null;
    return {
      item: { kind: cardKind, ref, title: interactable.title },
      position: interactable.anchor,
      maxDistance: interactable.maxDistance,
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
      maxDistance: interactable.maxDistance,
    };
  }
  return {
    item: { kind: "seat", seatId: interactable.id, title: interactable.title },
    position: interactable.anchor,
    maxDistance: interactable.maxDistance,
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
  return chooseTarget(eye, forward, candidates);
}
