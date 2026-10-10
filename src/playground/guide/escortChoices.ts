import type { NpcId } from "./knowledge";
export type EscortGoal = "pools" | "camp" | "pier" | "lookout";
const interests: Record<NpcId, readonly EscortGoal[]> = {
  nagi: ["pools", "lookout"],
  cat: ["camp", "lookout"],
  dog: ["pier", "pools"],
  panda: ["pier", "camp"],
  fox: ["lookout", "camp"],
  penguin: ["pier", "camp"],
  rabbit: ["lookout", "pools"],
  bear: ["camp", "pier"],
  koala: ["camp", "lookout"],
  frog: ["pools", "pier"],
  owl: ["pools", "lookout"],
};
export const ESCORT_LABELS: Record<EscortGoal, string> = {
  pools: "Watch crabs and find shells",
  pier: "Float objects at the pier",
  camp: "Shelter and watch the sky",
  lookout: "Look for the hidden cove",
};
export function escortChoices(
  id: NpcId,
  currentPlace = "",
): readonly EscortGoal[] {
  const places: Record<EscortGoal, string> = {
    pools: "Tide pools",
    pier: "Driftwood pier",
    camp: "Beach camp",
    lookout: "Dune lookout",
  };
  return interests[id].filter((goal) => places[goal] !== currentPlace);
}
