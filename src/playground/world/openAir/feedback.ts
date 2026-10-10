import { ITEM_BY_ID, type OpenAirAction, type OpenAirState } from "./model";

/** Test the result at this exact commit, before another participant can change it. */
export function actionWasApplied(
  before: OpenAirState,
  after: OpenAirState,
  actor: string,
  action: OpenAirAction,
): boolean {
  switch (action.kind) {
    case "take":
    case "renew":
      return (
        after.objects[action.id]?.owner === actor &&
        after.objects[action.id] !== before.objects[action.id]
      );
    case "throw":
    case "place":
    case "push":
      return (
        after.objects[action.id]?.actor === actor &&
        after.objects[action.id] !== before.objects[action.id]
      );
    case "seat":
      return (
        after.seats[action.id]?.owner === actor &&
        after.seats[action.id] !== before.seats[action.id]
      );
    case "stand":
      return !after.seats[action.id];
    case "lease":
      return (
        after.leases[action.id]?.owner === actor &&
        (!action.goal || after.leases[action.id]?.goal === action.goal) &&
        after.leases[action.id] !== before.leases[action.id]
      );
    case "release":
      return !after.leases[action.id];
    case "deliver":
      return (
        before.objects.keepsake?.owner === actor &&
        after.objects.keepsake?.owner === null
      );
    case "repair":
      return after.repairs !== before.repairs;
    case "mark":
      return after.marks !== before.marks;
    case "observe":
      return after.observations[actor]?.includes(action.id) ?? false;
    case "react":
      return after.encounters !== before.encounters;
  }
}

export function interactionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/plaza_out_of_reach/.test(message))
    return "Move a little closer, then try again.";
  if (/plaza_presence_required/.test(message))
    return "Your position is reconnecting. Try again in a moment.";
  if (/epoch|conflict|checkpoint/.test(message))
    return "The plaza changed. Reconnecting before you try again.";
  if (/401|403|unauthorized|permission/.test(message))
    return "Sign in again to interact with the plaza.";
  if (/429|rate_limit/.test(message))
    return "Please wait a moment before trying again.";
  return "This action could not be saved. Check your connection and try again.";
}

export function committedNotice(action: OpenAirAction): string {
  const kind = ITEM_BY_ID.get(action.id)?.kind ?? "object";
  switch (action.kind) {
    case "take":
      return `Holding ${kind}. Place it, or hold Throw to aim.`;
    case "place":
      return "Placed. Try another object beside it or on top.";
    case "throw":
      return "Thrown. Watch the object and the neighbors.";
    case "seat":
      return "Seated. Look around; move or jump to stand.";
    case "deliver":
      return "Olive has her shell back.";
    case "repair":
      return "Wood added to the shelter. The roof is taking shape.";
    case "mark":
      return "Sand mark left. The tide will wash it away.";
    case "release":
      return "Your neighbor returned to their activity.";
    case "lease":
      return action.goal
        ? "Your neighbor is ready. Walk together."
        : "Your neighbor is listening.";
    default:
      return "";
  }
}
