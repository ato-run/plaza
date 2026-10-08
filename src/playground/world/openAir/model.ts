import { terrainHeight, SEA_LEVEL } from "../beach/coast";
import {
  landmarkGround,
  TRAY,
  CAMP_SEATS,
  explorationColliders,
} from "./layout";
import { worldMoment } from "./clock";
import { centralFurnitureColliders } from "../worlds/centralGeometry";
import { blockingColliders, resolveMovement, overlaps } from "../collision";
const itemColliders = [
  ...centralFurnitureColliders(),
  ...explorationColliders(),
];
const itemGround = (x: number, z: number) =>
  Math.max(
    landmarkGround(x, z, terrainHeight(x, z)),
    ...itemColliders
      .filter((c) => c.top !== undefined && overlaps(c, x, z, 0.05))
      .map((c) => c.top!),
  );
const flights = new WeakMap<ItemState, { x: number; z: number }[]>();
function flightPositions(saved: ItemState, ball: boolean) {
  const old = flights.get(saved);
  if (old) return old;
  let x = saved.x,
    z = saved.z,
    vx = saved.vx,
    vz = saved.vz;
  const points = [{ x, z }];
  for (let i = 1; i <= 60; i++) {
    const t = i / 40,
      feet =
        itemGround(x, z) +
        0.09 +
        (t < 0.8 ? Math.sin((t / 0.8) * Math.PI) * 1.2 : 0);
    const dx = vx / 40,
      dz = vz / 40,
      next = resolveMovement(
        { x, z },
        { vx: dx, vz: dz },
        blockingColliders(itemColliders, feet),
        0.1,
        Infinity,
        (px, pz) => Math.abs(px) < 54 && Math.abs(pz) < 54,
      );
    if (Math.abs(next.x - x - dx) > 0.001) vx = ball ? -vx * 0.65 : 0;
    if (Math.abs(next.z - z - dz) > 0.001) vz = ball ? -vz * 0.65 : 0;
    x = next.x;
    z = next.z;
    if (t > 0.8) {
      vx *= 0.9;
      vz *= 0.9;
    }
    points.push({ x, z });
  }
  flights.set(saved, points);
  return points;
}

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
    z: -31 + Math.floor(i / 3) * 1.6,
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
  { id: "ball-0", kind: "ball", x: 7, z: 8 },
  { id: "ball-1", kind: "ball", x: 19, z: 14 },
  { id: "keepsake", kind: "shell", x: -19, z: -28 },
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
  | { kind: "take"; id: string; x: number; z: number }
  | {
      kind: "place" | "throw";
      id: string;
      x: number;
      z: number;
      vx: number;
      vz: number;
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
      id: "crab" | "stars" | "sunset" | "fountain" | "keepsake";
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
}
export const emptyOpenAir = (): OpenAirState => ({
  v: 1,
  cursor: 0,
  objects: {},
  leases: {},
  encounters: {},
  seats: {},
  observations: {},
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
    return ["crab", "stars", "sunset", "fountain", "keepsake"].includes(a.id);
  if (!ITEM_BY_ID.has(a.id)) return false;
  if (a.kind === "take") return true;
  return (
    (a.kind === "place" || a.kind === "throw") &&
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
): { x: number; y: number; z: number; held: boolean } {
  const active =
    saved && !(saved.owner && now - saved.at > 90000) ? saved : undefined;
  let x = active?.x ?? item.x,
    z = active?.z ?? item.z;
  const age = active ? Math.max(0, (now - active.at) / 1000) : 0;
  // Fixed-step swept collision path, cached by the immutable committed item state.
  if (active && !active.owner) {
    const path = flightPositions(active, item.kind === "ball"),
      t = Math.min(age * 40, 60),
      i = Math.floor(t),
      a = path[i],
      b = path[Math.min(i + 1, 60)];
    x = a.x + (b.x - a.x) * (t - i);
    z = a.z + (b.z - a.z) * (t - i);
  }
  if (active && !active.owner && item.kind === "leaf") {
    const wind = worldMoment(active.at).wind,
      drift = Math.min(age, 8) * wind * 0.08;
    x += drift;
    z -= drift * 0.35;
  }
  let y = itemGround(x, z) + 0.09;
  const water = SEA_LEVEL + worldMoment(now).tide;
  if (
    (item.kind === "wood" || item.kind === "ball" || item.kind === "leaf") &&
    y < water
  ) {
    if (active) {
      const drift = Math.min(age, 12);
      x += Math.sin(active.at / 30000) * drift * 0.025;
      z -= drift * 0.018;
    }
    y = water + 0.045 + Math.sin(now / 700 + x) * 0.025;
  }
  if (active && Math.hypot(active.vx, active.vz) > 0 && age < 0.8)
    y += Math.sin((age / 0.8) * Math.PI) * 1.2;
  return { x, y, z, held: !!active?.owner };
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
      ].slice(-8),
    };
    return next;
  }
  if (action.kind === "observe") {
    if (action.id === "keepsake") return next;
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
    ].slice(-8);
    next.observations = observations;
    return next;
  }
  const item = ITEM_BY_ID.get(action.id)!;
  const saved = state.objects[item.id];
  const position = itemPosition(item, saved, at);
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
        vx: 0,
        vz: 0,
      },
    };
  } else {
    if (!saved || saved.owner !== actor || at - saved.at > 90000) return next;
    // A held object cannot be delivered remotely beyond the actor's bounded action point.
    next.objects = {
      ...state.objects,
      [item.id]: {
        actor,
        owner: null,
        at,
        x: action.x,
        z: action.z,
        vx: action.kind === "throw" ? action.vx : 0,
        vz: action.kind === "throw" ? action.vz : 0,
      },
    };
    const landed = itemPosition(item, next.objects[item.id], at + 1500);
    if (
      item.kind === "shell" &&
      activeLease(state, "owl", at)?.owner === actor &&
      Math.hypot(landed.x - TRAY.x, landed.z - TRAY.z) < TRAY.radius
    )
      remember(
        "owl",
        "shell arrangement",
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
      Math.hypot(raw.vx, raw.vz) <= 8
    )
      out.objects[id] = raw as unknown as ItemState;
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
            ["crab", "stars", "sunset", "fountain", "keepsake"].includes(s),
        )
        .slice(-8);
  return out;
}
