export const RESIDENT_NAMES: Record<string, string> = {
  nagi: "Nagi",
  cat: "Calico",
  dog: "Sora",
  panda: "Momo",
  fox: "Rusty",
  penguin: "Pip",
  rabbit: "Clover",
  bear: "Bruno",
  koala: "Kiki",
  frog: "Lily",
  owl: "Olive",
};
export const DISCOVERIES: Record<string, { title: string; hint: string }> = {
  fountain: {
    title: "The fountain rim",
    hint: "From a higher place, look for another route to the sea.",
  },
  crab: {
    title: "Crabs come out when you slow down",
    hint: "Invite Lily, or arrange the shells beside the pool.",
  },
  stars: {
    title: "Stars over beach camp",
    hint: "Take a seat, or follow the shore lights toward the pier.",
  },
  sunset: {
    title: "Sunset across the sea",
    hint: "The lookout offers another view; floating wood follows the current.",
  },
  keepsake: {
    title: "Olive’s shell returned",
    hint: "Try a line or a ring of shells on the stone tray.",
  },
  lookout: {
    title: "Dune lookout",
    hint: "A shell spiral marks the hidden cove below. Try the rock route down.",
  },
  pools: {
    title: "Tide pools",
    hint: "Move slowly to watch the crabs; a low stone throw can skip on water.",
  },
  pier: {
    title: "Driftwood pier",
    hint: "Place a shell on wood to float it, or lay wood across a shallow gap.",
  },
  camp: {
    title: "Beach camp",
    hint: "The roof shelters you from rain. Bring wood to Bruno’s repair bench.",
  },
};
export function discoveryTitle(id: string): string {
  return DISCOVERIES[id]?.title ?? "A discovery";
}
export function encounterTitle(id: string, kind: string): string {
  const event: Record<string, string> = {
    wave: "waved back",
    reaction: "shared a reaction",
    "shell arrangement": "noticed your shells",
    "returned my shell": "received her lost shell",
    "shell line": "noticed your line of shells",
    "shell ring": "noticed your ring of shells",
    "shell cluster": "noticed your shell collection",
    repair: "used your wood to repair the shelter",
    ball: "chased your ball",
  };
  return `${RESIDENT_NAMES[id] ?? "Your neighbor"} ${event[kind] ?? kind}`;
}
