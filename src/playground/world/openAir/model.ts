import { driftwoodWork } from "./work";
import { terrainHeight, SEA_LEVEL } from "../beach/coast";
import { OPEN_AIR_PLACES, TRAY, CAMP_SEATS } from "./layout";
import { worldMoment } from "./clock";
import {
  freeObjectPosition,
  objectGround,
  ITEM_PHYSICS,
  supportsObject,
  type ObjectPosition,
} from "./physics";
export type ItemKind = "stone" | "shell" | "wood" | "ball" | "leaf";
export interface Item {
  id: string;
  kind: ItemKind;
  x: number;
  z: number;
}
export const ITEMS: readonly Item[] = [
  ...Array.from({ length: 9 }, (_, i) => ({
    id: `shell-${i}`,
    kind: "shell" as const,
    x: -20 + (i % 3) * 1.4,
    z: -32 + Math.floor(i / 3) * 0.7,
  })),
  ...Array.from({ length: 6 }, (_, i) => ({
    id: `stone-${i}`,
    kind: "stone" as const,
    x: 10 + i * 1.6,
    z: -23 - (i % 2),
  })),
  ...Array.from({ length: 5 }, (_, i) => ({
    id: `wood-${i}`,
    kind: "wood" as const,
    x: 17 + i * 1.2,
    z: -31 + (i % 2),
  })),
  ...Array.from({ length: 6 }, (_, i) => ({
    id: `leaf-${i}`,
    kind: "leaf" as const,
    x: 17 + (i % 3),
    z: 13 + Math.floor(i / 3),
  })),
  { id: "ball-0", kind: "ball", x: -1.3, z: 9 },
  { id: "ball-1", kind: "ball", x: 19, z: 14 },
  { id: "pier-wood-0", kind: "wood", x: 23.3, z: -46.5 },
  { id: "pier-leaf-0", kind: "leaf", x: 20.7, z: -45.3 },
  ...Array.from({ length: 4 }, (_, i) => ({
    id: `east-leaf-${i}`,
    kind: "leaf" as const,
    x: 24,
    z: -16 + i * 8,
  })),
  { id: "loop-wood-0", kind: "wood", x: -15, z: 18 },
  { id: "loop-stone-0", kind: "stone", x: -26, z: 16 },
  ...Array.from({ length: 17 }, (_, i) => ({
    id: `trail-shell-${i}`,
    kind: "shell" as const,
    x: -3 - i * 0.85,
    z: 8 - i * 2,
  })),
  ...Array.from({ length: 5 }, (_, i) => ({
    id: `shore-wood-${i}`,
    kind: "wood" as const,
    x: -10 + i * 5,
    z: -25 + (i % 2) * 2,
  })),
  ...Array.from({ length: 5 }, (_, i) => ({
    id: `shore-leaf-${i}`,
    kind: "leaf" as const,
    x: -9 + i * 5,
    z: -23,
  })),
  ...Array.from({ length: 6 }, (_, i) => ({
    id: `spiral-shell-${i}`,
    kind: "shell" as const,
    x: -32 + Math.cos(i * 1.1) * (1 + i * 0.3),
    z: -16 + Math.sin(i * 1.1) * (1 + i * 0.3),
  })),
  { id: "keepsake", kind: "shell", x: -20.5, z: -30 },
];
export const ITEM_BY_ID = new Map(ITEMS.map((item) => [item.id, item]));
export const RESIDENT_IDS = [
  "nagi",
  "cat",
  "dog",
  "panda",
  "fox",
  "penguin",
  "rabbit",
  "bear",
  "koala",
  "frog",
  "owl",
] as const;
export type ResidentId = (typeof RESIDENT_IDS)[number];
export type OpenAirAction =
  | { kind: "seat"; id: string; x: number; z: number }
  | { kind: "stand"; id: string }
  | { kind: "renew"; id: string; x: number; z: number }
  | { kind: "push"; id: string; x: number; z: number; vx: number; vz: number }
  | { kind: "mark"; id: "sand"; x: number; z: number; dx: number; dz: number }
  | { kind: "repair"; id: "bear"; x: number; z: number }
  | { kind: "take"; id: string; x: number; z: number }
  | {
      kind: "place" | "throw";
      id: string;
      x: number;
      z: number;
      vx: number;
      vz: number;
      y?: number;
      vy?: number;
      yaw?: number;
      support?: string;
    }
  | {
      kind: "lease";
      id: ResidentId;
      x: number;
      z: number;
      goal?: "pools" | "camp" | "pier" | "lookout";
    }
  | { kind: "release"; id: ResidentId }
  | { kind: "react"; id: ResidentId; emoji: string; x: number; z: number }
  | { kind: "deliver"; id: "owl"; x: number; z: number }
  | {
      kind: "observe";
      id:
        | "crab"
        | "stars"
        | "sunset"
        | "fountain"
        | "keepsake"
        | "lookout"
        | "pools"
        | "pier"
        | "camp";
      x: number;
      z: number;
    };
export interface ItemState {
  actor?: string;
  owner: string | null;
  at: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  y?: number;
  vy?: number;
  yaw?: number;
  support?: string;
  dx?: number;
  dz?: number;
  contact?: {
    target?: string;
    targetAt?: number;
    delay: number;
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
  };
  previous?: ItemState;
}
export interface ResidentLease {
  owner: string;
  x: number;
  z: number;
  at: number;
  startedAt?: number;
  goal?: "pools" | "camp" | "pier" | "lookout";
}
export interface Encounter {
  id: ResidentId;
  kind: string;
  at: number;
  x: number;
  z: number;
  emoji?: string;
}
export interface OpenAirState {
  v: 1;
  cursor: number;
  objects: Record<string, ItemState>;
  leases: Partial<Record<ResidentId, ResidentLease>>;
  encounters: Record<string, Encounter[]>;
  seats: Record<string, { owner: string; at: number }>;
  observations: Record<string, string[]>;
  marks?: {
    actor: string;
    at: number;
    x: number;
    z: number;
    dx: number;
    dz: number;
  }[];
  repairs?: Record<string, number>;
}
export const emptyOpenAir = (): OpenAirState => ({
  v: 1,
  cursor: 0,
  objects: {},
  leases: {},
  encounters: {},
  seats: {},
  observations: {},
  marks: [],
  repairs: {},
});
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const coordinate = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 54;
export function isOpenAirAction(a: unknown): a is OpenAirAction {
  if (!record(a) || typeof a.kind !== "string" || typeof a.id !== "string")
    return false;
  const person = (RESIDENT_IDS as readonly string[]).includes(a.id);
  if (a.kind === "stand")
    return CAMP_SEATS.some((s) => s.id === a.id) && Object.keys(a).length === 2;
  if (a.kind === "release") return person && Object.keys(a).length === 2;
  if (!coordinate(a.x) || !coordinate(a.z)) return false;
  if (a.kind === "mark")
    return (
      a.id === "sand" &&
      typeof a.dx === "number" &&
      typeof a.dz === "number" &&
      Number.isFinite(a.dx) &&
      Number.isFinite(a.dz) &&
      Math.hypot(a.dx, a.dz) <= 1.8
    );
  if (a.kind === "repair") return a.id === "bear";
  if (a.kind === "renew") return ITEM_BY_ID.has(a.id);
  if (a.kind === "seat") return CAMP_SEATS.some((s) => s.id === a.id);
  if (a.kind === "lease")
    return (
      person &&
      (a.goal === undefined ||
        ["pools", "camp", "pier", "lookout"].includes(String(a.goal)))
    );
  if (a.kind === "react")
    return person && ["👋", "❤️", "😂", "👍"].includes(String(a.emoji));
  if (a.kind === "deliver") return person && a.id === "owl";
  if (a.kind === "observe")
    return [
      "crab",
      "stars",
      "sunset",
      "fountain",
      "keepsake",
      "lookout",
      "pools",
      "pier",
      "camp",
    ].includes(a.id);
  if (!ITEM_BY_ID.has(a.id)) return false;
  if (a.kind === "take") return true;
  return (
    (a.kind === "place" || a.kind === "throw" || a.kind === "push") &&
    (a.y === undefined ||
      (typeof a.y === "number" &&
        Number.isFinite(a.y) &&
        a.y >= -3 &&
        a.y <= 12)) &&
    (a.vy === undefined ||
      (typeof a.vy === "number" &&
        Number.isFinite(a.vy) &&
        Math.abs(a.vy) <= 8)) &&
    (a.yaw === undefined ||
      (typeof a.yaw === "number" &&
        Number.isFinite(a.yaw) &&
        Math.abs(a.yaw) <= Math.PI * 2)) &&
    (a.support === undefined ||
      (typeof a.support === "string" &&
        ITEM_BY_ID.has(a.support) &&
        a.support !== a.id)) &&
    typeof a.vx === "number" &&
    typeof a.vz === "number" &&
    Number.isFinite(a.vx) &&
    Number.isFinite(a.vz) &&
    Math.hypot(a.vx, a.vz) <= 8
  );
}
export function itemPosition(
  item: Item,
  saved: ItemState | undefined,
  now: number,
  state?: OpenAirState,
  chain = new Set<string>(),
): ObjectPosition {
  const p = freeObjectPosition(item, saved, now, state);
  if (
    state &&
    item.kind === "wood" &&
    objectGround(p.x, p.z) < SEA_LEVEL + worldMoment(now).tide
  ) {
    const loads = Object.entries(state.objects).filter(
      ([, s]) => s.support === item.id,
    );
    const mass = loads.reduce(
      (sum, [id]) => sum + ITEM_PHYSICS[ITEM_BY_ID.get(id)!.kind].mass,
      0,
    );
    p.y -= Math.min(0.08, mass * 0.04);
    p.roll =
      loads.reduce(
        (sum, [id, s]) =>
          sum + (s.dx ?? 0) * ITEM_PHYSICS[ITEM_BY_ID.get(id)!.kind].mass,
        0,
      ) * 0.3;
  }
  if (!saved && item.id === "wood-0") {
    const work = driftwoodWork(now);
    if (work.active && work.carrying)
      return {
        ...p,
        x: work.x,
        z: work.z,
        y: objectGround(work.x, work.z) + 1.05,
        held: true,
        carrier: "panda",
      };
    if (work.active && work.z > 16)
      return { ...p, x: 23, z: 17, y: objectGround(23, 17) + 0.09 };
  }
  if (state && !p.held && saved?.support && !chain.has(item.id)) {
    const support = ITEM_BY_ID.get(saved.support),
      base = state.objects[saved.support];
    if (support && base && !base.owner) {
      chain.add(item.id);
      const b = itemPosition(support, base, now, state, chain);
      return {
        ...p,
        x: b.x + (saved.dx ?? 0),
        z: b.z + (saved.dz ?? 0),
        y:
          b.y +
          ITEM_PHYSICS[support.kind].height / 2 +
          ITEM_PHYSICS[item.kind].height / 2,
      };
    }
  }
  // A weight resting on a leaf suppresses its wind drift.
  if (
    state &&
    item.kind === "leaf" &&
    Object.values(state.objects).some((other) => other.support === item.id)
  )
    return {
      ...p,
      x: saved?.x ?? item.x,
      z: saved?.z ?? item.z,
      y: saved?.y ?? objectGround(item.x, item.z) + 0.02,
    };
  return p;
}
export function shellArrangement(state: OpenAirState, now: number): string {
  const points = ITEMS.filter((i) => i.kind === "shell")
    .map((i) => itemPosition(i, state.objects[i.id], now, state))
    .filter(
      (p) => !p.held && Math.hypot(p.x - TRAY.x, p.z - TRAY.z) < TRAY.radius,
    );
  if (points.length < 3) return "shell arrangement";
  const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length,
    cz = points.reduce((sum, p) => sum + p.z, 0) / points.length;
  let xx = 0,
    zz = 0,
    xz = 0;
  for (const p of points) {
    xx += (p.x - cx) ** 2;
    zz += (p.z - cz) ** 2;
    xz += (p.x - cx) * (p.z - cz);
  }
  const spread = xx + zz,
    minor = (spread - Math.hypot(xx - zz, 2 * xz)) / 2;
  if (spread > 0.08 && minor / spread < 0.045) return "shell line";
  const radii = points.map((p) => Math.hypot(p.x - cx, p.z - cz)),
    mean = radii.reduce((a, b) => a + b, 0) / radii.length;
  if (
    points.length >= 4 &&
    mean > 0.25 &&
    radii.every((r) => Math.abs(r - mean) < 0.18)
  )
    return "shell ring";
  return "shell cluster";
}
export function activeLease(
  state: OpenAirState,
  id: ResidentId,
  now: number,
): ResidentLease | undefined {
  const lease = state.leases[id];
  return lease && now - lease.at < 30000 ? lease : undefined;
}
export function heldItem(
  state: OpenAirState,
  owner: string,
  now: number,
): string | undefined {
  return Object.keys(state.objects).find(
    (id) =>
      state.objects[id].owner === owner && now - state.objects[id].at < 90000,
  );
}
/** Server-recorded actor and commit time are inputs; never trust them inside an action. */
export function applyOpenAir(
  state: OpenAirState,
  seq: number,
  actor: string,
  at: number,
  action: unknown,
): OpenAirState {
  if (seq <= state.cursor) return state;
  const next = { ...state, cursor: seq };
  if (!actor || !Number.isFinite(at) || !isOpenAirAction(action)) return next;
  const remember = (
    id: ResidentId,
    kind: string,
    x: number,
    z: number,
    emoji?: string,
    when = at,
  ) => {
    const encounters = { ...state.encounters };
    if (!encounters[actor] && Object.keys(encounters).length >= 50)
      delete encounters[Object.keys(encounters)[0]];
    encounters[actor] = [
      ...(encounters[actor] ?? []).filter((e) => at - e.at < 900000),
      { id, kind, at: when, x, z, ...(emoji ? { emoji } : {}) },
    ].slice(-4);
    next.encounters = encounters;
  };
  if (action.kind === "mark") {
    if (terrainHeight(action.x, action.z) < SEA_LEVEL + worldMoment(at).tide)
      return next;
    next.marks = [
      ...(state.marks ?? []).filter((mark) => at - mark.at < 45000),
      { actor, at, x: action.x, z: action.z, dx: action.dx, dz: action.dz },
    ].slice(-64);
    return next;
  }
  if (action.kind === "repair") {
    const id = heldItem(state, actor, at),
      item = id && ITEM_BY_ID.get(id);
    if (
      !id ||
      !item ||
      item.kind !== "wood" ||
      Math.hypot(action.x - 23, action.z - 17) > 3
    )
      return next;
    next.repairs = { ...state.repairs, [id]: at };
    next.objects = {
      ...state.objects,
      [id]: {
        owner: null,
        actor,
        at,
        x: 23,
        z: 17 + (Object.keys(state.repairs ?? {}).length % 3) * 0.22,
        vx: 0,
        vz: 0,
        yaw: Math.PI / 2,
      },
    };
    remember("bear", "repair", action.x, action.z);
    return next;
  }
  if (action.kind === "renew") {
    const held = state.objects[action.id];
    if (held?.owner === actor && at - held.at < 90000)
      next.objects = {
        ...state.objects,
        [action.id]: { ...held, at, x: action.x, z: action.z },
      };
    return next;
  }
  if (action.kind === "seat") {
    const seat = CAMP_SEATS.find((s) => s.id === action.id)!,
      old = state.seats[action.id];
    if (
      Math.hypot(action.x - seat.x, action.z - seat.z) > 3 ||
      (old && at - old.at < 30000 && old.owner !== actor)
    )
      return next;
    if (
      Object.entries(state.seats).some(
        ([id, s]) => id !== action.id && s.owner === actor && at - s.at < 30000,
      )
    )
      return next;
    next.seats = { ...state.seats, [action.id]: { owner: actor, at } };
    return next;
  }
  if (action.kind === "stand") {
    if (state.seats[action.id]?.owner !== actor) return next;
    const seats = { ...state.seats };
    delete seats[action.id];
    next.seats = seats;
    return next;
  }
  if (action.kind === "lease") {
    const old = activeLease(state, action.id, at);
    if (old && old.owner !== actor) return next;
    if (
      !old &&
      Object.values(state.leases).some(
        (other) =>
          other &&
          at - other.at < 30000 &&
          Math.hypot(other.x - action.x, other.z - action.z) < 0.8,
      )
    )
      return next;
    // Escort renewals commit the current waypoint so late joiners rejoin the same route.
    next.leases = {
      ...state.leases,
      [action.id]: old
        ? {
            ...old,
            at,
            ...(old.goal ? { x: action.x, z: action.z } : {}),
            goal: action.goal ?? old.goal,
            startedAt:
              old.goal || (action.goal && action.goal !== old.goal)
                ? at
                : old.startedAt,
          }
        : {
            owner: actor,
            at,
            startedAt: at,
            x: action.x,
            z: action.z,
            goal: action.goal,
          },
    };
    return next;
  }
  if (action.kind === "release") {
    if (state.leases[action.id]?.owner !== actor) return next;
    const leases = { ...state.leases };
    delete leases[action.id];
    next.leases = leases;
    return next;
  }
  if (action.kind === "react") {
    remember(
      action.id,
      action.emoji === "👋" ? "wave" : "reaction",
      action.x,
      action.z,
      action.emoji,
    );
    return next;
  }
  if (action.kind === "deliver") {
    const lease = activeLease(state, "owl", at),
      item = state.objects.keepsake;
    if (
      !lease ||
      lease.owner !== actor ||
      !item ||
      item.owner !== actor ||
      at - item.at > 90000 ||
      Math.hypot(action.x - lease.x, action.z - lease.z) > 4
    )
      return next;
    next.objects = {
      ...state.objects,
      keepsake: { owner: null, at, x: TRAY.x, z: TRAY.z, vx: 0, vz: 0 },
    };
    remember("owl", "returned my shell", action.x, action.z);
    next.observations = {
      ...state.observations,
      [actor]: [
        ...new Set([...(state.observations[actor] ?? []), "keepsake"]),
      ].slice(-12),
    };
    return next;
  }
  if (action.kind === "observe") {
    if (action.id === "keepsake") return next;
    const place = OPEN_AIR_PLACES.find((p) => p.id === action.id);
    if (
      place &&
      Math.hypot(action.x - place.x, action.z - place.z) > place.radius
    )
      return next;
    if (
      (action.id === "stars" || action.id === "sunset") &&
      Math.hypot(action.x - 18, action.z - 15) > 6
    )
      return next;
    if (action.id === "stars" && worldMoment(at).phase !== "night") return next;
    if (action.id === "sunset" && worldMoment(at).phase !== "sunset")
      return next;
    if (action.id === "crab" && Math.hypot(action.x + 18, action.z + 29) > 6)
      return next;
    if (action.id === "fountain" && Math.hypot(action.x, action.z) > 4)
      return next;
    const observations = { ...state.observations };
    if (!observations[actor] && Object.keys(observations).length >= 50)
      delete observations[Object.keys(observations)[0]];
    observations[actor] = [
      ...new Set([...(observations[actor] ?? []), action.id]),
    ].slice(-12);
    next.observations = observations;
    return next;
  }
  const item = ITEM_BY_ID.get(action.id)!;
  const saved = state.objects[item.id];
  const position = itemPosition(item, saved, at, state);
  const cancelFutureContacts = () => {
    for (const [id, object] of Object.entries(next.objects))
      if (
        object.contact?.target === item.id &&
        (object.contact.targetAt ?? 0) > at
      ) {
        const replacement = { ...object };
        delete replacement.contact;
        next.objects = { ...next.objects, [id]: replacement };
      }
  };
  if (action.kind === "push") {
    if (
      item.kind !== "ball" ||
      position.held ||
      Math.hypot(action.x - position.x, action.z - position.z) > 0.9 ||
      Math.hypot(action.vx, action.vz) > 2.8
    )
      return next;
    next.objects = {
      ...state.objects,
      [item.id]: {
        actor,
        owner: null,
        at,
        x: position.x,
        y: position.y,
        z: position.z,
        vx: action.vx,
        vz: action.vz,
        vy: 0,
      },
    };
    remember("dog", "ball", position.x, position.z);
    cancelFutureContacts();
    return next;
  }
  if (action.kind === "take") {
    if (
      position.held ||
      heldItem(state, actor, at) ||
      Math.hypot(action.x - position.x, action.z - position.z) > 3.2
    )
      return next;
    next.objects = {
      ...state.objects,
      [item.id]: {
        actor,
        owner: actor,
        at,
        x: position.x,
        z: position.z,
        y: position.y,
        yaw: position.yaw,
        vx: 0,
        vz: 0,
      },
    };
    cancelFutureContacts();
  } else {
    if (!saved || saved.owner !== actor || at - saved.at > 90000) return next;
    let support: Item | undefined, supportPosition: ObjectPosition | undefined;
    if (action.kind === "place" && action.support) {
      support = ITEM_BY_ID.get(action.support);
      if (!support || heldItem(state, actor, at) === support.id) return next;
      supportPosition = itemPosition(
        support,
        state.objects[support.id],
        at,
        state,
      );
      let ancestor: string | undefined = support.id;
      const seen = new Set<string>();
      while (ancestor) {
        if (ancestor === item.id || seen.has(ancestor)) return next;
        seen.add(ancestor);
        ancestor = state.objects[ancestor]?.support;
      }
      if (
        supportPosition.held ||
        !supportsObject(support, supportPosition, action.x, action.z)
      )
        return next;
    }
    // Height must be a reachable launch or the actual support surface.
    const ground = objectGround(action.x, action.z),
      y =
        action.kind === "place"
          ? (support && supportPosition
              ? supportPosition.y + ITEM_PHYSICS[support.kind].height / 2
              : ground) +
            ITEM_PHYSICS[item.kind].height / 2
          : (action.y ?? ground + 0.1);
    if (action.kind === "throw" && y > ground + 2.6) return next;
    next.objects = {
      ...state.objects,
      ...(support &&
      supportPosition &&
      (!state.objects[support.id] || support.kind === "leaf")
        ? {
            [support.id]: {
              owner: null,
              at,
              x: supportPosition.x,
              y: supportPosition.y,
              z: supportPosition.z,
              vx: 0,
              vz: 0,
              vy: 0,
              yaw: supportPosition.yaw,
            },
          }
        : {}),
      [item.id]: {
        actor,
        owner: null,
        at,
        x: action.x,
        z: action.z,
        vx: action.kind === "throw" ? action.vx : 0,
        vz: action.kind === "throw" ? action.vz : 0,
        y,
        vy: action.kind === "throw" ? (action.vy ?? 4.2) : 0,
        yaw: action.yaw ?? saved.yaw ?? 0,
        ...(support && supportPosition
          ? {
              support: support.id,
              dx: action.x - supportPosition.x,
              dz: action.z - supportPosition.z,
            }
          : {}),
      },
    };
    if (support?.kind === "wood" && supportPosition) {
      const boat = itemPosition(support, next.objects[support.id], at, next);
      if (Math.abs(boat.roll ?? 0) > 0.14) {
        const dropped = { ...next.objects };
        for (const [id, load] of Object.entries(next.objects))
          if (load.support === support.id) {
            const carried = ITEM_BY_ID.get(id)!,
              p = itemPosition(carried, load, at, next);
            dropped[id] = {
              actor,
              owner: null,
              at,
              x: p.x,
              y: p.y,
              z: p.z,
              vx: Math.sign(boat.roll ?? 0) * 0.5,
              vz: 0,
              vy: 0,
              yaw: p.yaw,
            };
          }
        next.objects = dropped;
      }
    }
    if (action.kind === "throw") {
      const launch = next.objects[item.id],
        shape = ITEM_PHYSICS[item.kind];
      let collided = false;
      for (let tick = 1; tick <= 20 && !collided; tick++) {
        const delay = tick * 0.075,
          time = at + delay * 1000,
          p = itemPosition(item, launch, time, next);
        for (const other of ITEMS) {
          const otherSaved = state.objects[other.id];
          if (
            other.id === item.id ||
            otherSaved?.owner ||
            otherSaved?.support ||
            (otherSaved && Math.hypot(otherSaved.vx, otherSaved.vz) > 0.1)
          )
            continue;
          const op = itemPosition(other, state.objects[other.id], time, state),
            otherShape = ITEM_PHYSICS[other.kind];
          if (
            op.held ||
            Math.hypot(p.x - op.x, p.z - op.z) >
              shape.radius + otherShape.radius ||
            Math.abs(p.y - op.y) > (shape.height + otherShape.height) / 2
          )
            continue;
          const fraction = (2 * shape.mass) / (shape.mass + otherShape.mass),
            speed = Math.hypot(action.vx, action.vz);
          if (speed < 0.5) continue;
          const vx = action.vx * fraction * 0.45,
            vz = action.vz * fraction * 0.45;
          next.objects = {
            ...next.objects,
            [other.id]: {
              actor,
              owner: null,
              at: time,
              x: op.x,
              y: op.y,
              z: op.z,
              vx: Math.max(-5, Math.min(5, vx)),
              vz: Math.max(-5, Math.min(5, vz)),
              vy: 0,
              previous: {
                owner: null,
                at,
                x: op.x,
                y: op.y,
                z: op.z,
                vx: 0,
                vz: 0,
                vy: 0,
                yaw: op.yaw,
              },
              yaw: op.yaw,
            },
            [item.id]: {
              ...launch,
              contact: {
                target: other.id,
                targetAt: time,
                delay,
                x: p.x,
                y: p.y,
                z: p.z,
                vx: -action.vx * 0.25 || 0,
                vy: 0,
                vz: -action.vz * 0.25 || 0,
              },
            },
          };
          collided = true;
          break;
        }
      }
    }
    const landed = itemPosition(item, next.objects[item.id], at + 1500, next);
    if (
      item.kind === "shell" &&
      Math.hypot(landed.x - TRAY.x, landed.z - TRAY.z) < TRAY.radius
    )
      remember(
        "owl",
        shellArrangement(next, at + 1500),
        landed.x,
        landed.z,
        undefined,
        at + 1500,
      );
  }
  return next;
}
export function restoreOpenAir(value: unknown): OpenAirState {
  if (
    !record(value) ||
    value.v !== 1 ||
    !Number.isSafeInteger(value.cursor) ||
    !record(value.objects) ||
    !record(value.leases) ||
    !record(value.encounters) ||
    !record(value.observations)
  )
    return emptyOpenAir();
  const out = emptyOpenAir();
  out.cursor = Math.max(0, Number(value.cursor));
  for (const [id, raw] of Object.entries(value.objects).slice(
    0,
    ITEMS.length,
  )) {
    if (
      ITEM_BY_ID.has(id) &&
      record(raw) &&
      (raw.owner === null || typeof raw.owner === "string") &&
      coordinate(raw.x) &&
      coordinate(raw.z) &&
      typeof raw.at === "number" &&
      Number.isFinite(raw.at) &&
      typeof raw.vx === "number" &&
      typeof raw.vz === "number" &&
      Number.isFinite(raw.vx) &&
      Number.isFinite(raw.vz) &&
      Math.hypot(raw.vx, raw.vz) <= 8 &&
      (raw.y === undefined ||
        (typeof raw.y === "number" &&
          Number.isFinite(raw.y) &&
          raw.y >= -30 &&
          raw.y <= 12)) &&
      (raw.vy === undefined ||
        (typeof raw.vy === "number" &&
          Number.isFinite(raw.vy) &&
          Math.abs(raw.vy) <= 8)) &&
      (raw.yaw === undefined ||
        (typeof raw.yaw === "number" &&
          Number.isFinite(raw.yaw) &&
          Math.abs(raw.yaw) <= Math.PI * 2)) &&
      (raw.support === undefined ||
        (typeof raw.support === "string" &&
          ITEM_BY_ID.has(raw.support) &&
          raw.support !== id &&
          typeof raw.dx === "number" &&
          Number.isFinite(raw.dx) &&
          Math.abs(raw.dx) <= 0.7 &&
          typeof raw.dz === "number" &&
          Number.isFinite(raw.dz) &&
          Math.abs(raw.dz) <= 0.7))
    ) {
      const s: ItemState = {
        owner: raw.owner as string | null,
        at: raw.at as number,
        x: raw.x as number,
        z: raw.z as number,
        vx: raw.vx as number,
        vz: raw.vz as number,
      };
      if (typeof raw.actor === "string") s.actor = raw.actor;
      for (const key of ["y", "vy", "yaw", "dx", "dz"] as const)
        if (typeof raw[key] === "number") s[key] = raw[key] as number;
      if (typeof raw.support === "string") s.support = raw.support;
      const contact = raw.contact;
      if (
        record(contact) &&
        typeof contact.delay === "number" &&
        contact.delay > 0 &&
        contact.delay <= 1.5 &&
        coordinate(contact.x) &&
        coordinate(contact.z) &&
        typeof contact.y === "number" &&
        Number.isFinite(contact.y) &&
        contact.y >= -30 &&
        contact.y <= 12 &&
        typeof contact.vx === "number" &&
        typeof contact.vz === "number" &&
        Number.isFinite(contact.vx) &&
        Number.isFinite(contact.vz) &&
        Math.hypot(contact.vx, contact.vz) <= 8 &&
        typeof contact.vy === "number" &&
        Number.isFinite(contact.vy) &&
        Math.abs(contact.vy) <= 8 &&
        (contact.target === undefined ||
          (typeof contact.target === "string" &&
            ITEM_BY_ID.has(contact.target) &&
            typeof contact.targetAt === "number" &&
            Number.isFinite(contact.targetAt)))
      )
        s.contact = {
          delay: contact.delay,
          x: contact.x,
          y: contact.y,
          z: contact.z,
          vx: contact.vx,
          vz: contact.vz,
          vy: contact.vy,
          ...(typeof contact.target === "string"
            ? { target: contact.target, targetAt: contact.targetAt as number }
            : {}),
        };
      const previous = raw.previous;
      if (
        record(previous) &&
        previous.owner === null &&
        coordinate(previous.x) &&
        coordinate(previous.z) &&
        typeof previous.y === "number" &&
        Number.isFinite(previous.y) &&
        previous.y >= -30 &&
        previous.y <= 12 &&
        typeof previous.at === "number" &&
        Number.isFinite(previous.at) &&
        typeof previous.yaw === "number" &&
        Number.isFinite(previous.yaw) &&
        Math.abs(previous.yaw) <= Math.PI * 2
      )
        s.previous = {
          owner: null,
          at: previous.at,
          x: previous.x,
          y: previous.y,
          z: previous.z,
          vx: 0,
          vz: 0,
          vy: 0,
          yaw: previous.yaw,
        };
      out.objects[id] = s;
    }
  }
  for (const [id, s] of Object.entries(out.objects)) {
    let ancestor = s.support;
    const seen = new Set([id]);
    while (ancestor) {
      if (seen.has(ancestor)) {
        delete s.support;
        delete s.dx;
        delete s.dz;
        break;
      }
      seen.add(ancestor);
      ancestor = out.objects[ancestor]?.support;
    }
  }
  for (const [id, raw] of Object.entries(value.leases))
    if (
      (RESIDENT_IDS as readonly string[]).includes(id) &&
      record(raw) &&
      typeof raw.owner === "string" &&
      coordinate(raw.x) &&
      coordinate(raw.z) &&
      typeof raw.at === "number" &&
      Number.isFinite(raw.at) &&
      (raw.startedAt === undefined ||
        (typeof raw.startedAt === "number" &&
          Number.isFinite(raw.startedAt))) &&
      (raw.goal === undefined ||
        ["pools", "camp", "pier", "lookout"].includes(String(raw.goal)))
    )
      out.leases[id as ResidentId] = raw as unknown as ResidentLease;
  if (record(value.seats))
    for (const [id, raw] of Object.entries(value.seats))
      if (
        CAMP_SEATS.some((s) => s.id === id) &&
        record(raw) &&
        typeof raw.owner === "string" &&
        typeof raw.at === "number" &&
        Number.isFinite(raw.at)
      )
        out.seats[id] = { owner: raw.owner, at: raw.at };
  for (const [actor, raw] of Object.entries(value.encounters).slice(0, 50))
    if (Array.isArray(raw))
      out.encounters[actor] = raw
        .filter(
          (e): e is Encounter =>
            record(e) &&
            (RESIDENT_IDS as readonly string[]).includes(String(e.id)) &&
            typeof e.kind === "string" &&
            e.kind.length < 80 &&
            typeof e.at === "number" &&
            Number.isFinite(e.at) &&
            coordinate(e.x) &&
            coordinate(e.z),
        )
        .slice(-4);
  for (const [actor, raw] of Object.entries(value.observations).slice(0, 50))
    if (Array.isArray(raw))
      out.observations[actor] = raw
        .filter(
          (s): s is string =>
            typeof s === "string" &&
            [
              "crab",
              "stars",
              "sunset",
              "fountain",
              "keepsake",
              "lookout",
              "pools",
              "pier",
              "camp",
            ].includes(s),
        )
        .slice(-12);
  if (Array.isArray(value.marks))
    out.marks = value.marks
      .filter(
        (m): m is NonNullable<OpenAirState["marks"]>[number] =>
          record(m) &&
          typeof m.actor === "string" &&
          typeof m.at === "number" &&
          Number.isFinite(m.at) &&
          coordinate(m.x) &&
          coordinate(m.z) &&
          typeof m.dx === "number" &&
          typeof m.dz === "number" &&
          Number.isFinite(m.dx) &&
          Number.isFinite(m.dz) &&
          Math.hypot(m.dx, m.dz) <= 1.8,
      )
      .slice(-64);
  if (record(value.repairs))
    out.repairs = Object.fromEntries(
      Object.entries(value.repairs).filter(
        (entry): entry is [string, number] =>
          ITEM_BY_ID.get(entry[0])?.kind === "wood" &&
          typeof entry[1] === "number" &&
          Number.isFinite(entry[1]),
      ),
    );
  return out;
}
