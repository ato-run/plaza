import type { WorldTarget } from "./world/interaction";

/** Talk and Enter resolve the same subject as the interaction prompt. */
export function conversationNpc(target: WorldTarget | null): string | null {
  if (target?.kind === "guide") return "nagi";
  if (target?.kind === "mascot") return target.mascotId;
  return null;
}
