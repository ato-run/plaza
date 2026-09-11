/**
 * The eight Worlds, in the order they are shown.
 *
 * A registry rather than a switch: the selector, the HUD title and the engine
 * all need the same list, and three copies of it would drift. Registration is
 * separate from availability on purpose — an unbuilt World is still part of
 * what Playground is, so it is listed and refused rather than hidden.
 */
import { centralPlaza } from "./central-plaza";
import { market } from "./market";
import { campfire } from "./campfire";
import { treehouse } from "./treehouse";
import { lookout } from "./lookout";
import { meadow } from "./meadow";
import { ruins } from "./ruins";
import { stargazing } from "./stargazing";
import { DEFAULT_WORLD_ID, type WorldDefinition, type WorldId } from "../types";

/** Ordered by `index`, which is also what the HUD shows as `01`…`08`. */
export const WORLDS: readonly WorldDefinition[] = [
  centralPlaza,
  market,
  campfire,
  treehouse,
  lookout,
  meadow,
  ruins,
  stargazing,
];

const BY_ID = new Map<WorldId, WorldDefinition>(
  WORLDS.map((world) => [world.id, world]),
);

export function worldDefinition(id: WorldId): WorldDefinition {
  const found = BY_ID.get(id);
  // Every WorldId has a definition — the type and the registry are checked
  // against each other by a test — so this is a programming error, not a
  // runtime condition to handle.
  if (!found) throw new Error(`unknown_world:${id}`);
  return found;
}

/** The World to open, given a possibly-unavailable request. */
export function resolveOpenableWorld(id: WorldId): WorldDefinition {
  const requested = BY_ID.get(id);
  if (requested?.available) return requested;
  return worldDefinition(DEFAULT_WORLD_ID);
}
