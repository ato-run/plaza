/**
 * Playground v0 — wire types, transcribed from the SERVER.
 *
 * These are not a client's idea of the protocol. Every shape here was read
 * off ato-api's `services/lobby/api.ts` + `durable_objects/playground_room.ts`
 * and pinned against real staging responses (see `contract.test.ts`, whose
 * fixtures were captured from the live canonical host rather than written by
 * hand). The first cut of this file disagreed with the server on nearly every
 * name — `public_app_ref` vs `app_ref`, `participant_id` vs `principal_id`,
 * `emoji` vs `animal_emoji`, reactions as a side list vs nested on the post —
 * which is exactly the failure the fixtures now prevent from recurring.
 *
 * Served same-origin from the canonical Playground host, so there is no
 * account-API base in this lane at all:
 *   REST  `/__ato/playground/*`
 *   WS    `wss://<canonical host>/__ato/playground/connect`
 */

export type PlaygroundReaction = "❤️" | "😂" | "👀" | "👍" | "🔥";

export const PLAYGROUND_REACTIONS: readonly PlaygroundReaction[] = [
  "❤️",
  "😂",
  "👀",
  "👍",
  "🔥",
];

export type PlaygroundPostKind = "text" | "app" | "activity";

/**
 * Who the server says you are. `can_post` is the server's answer, never
 * inferred from the PWA's own account state — the Playground host resolves
 * identity from its own cookie, and a client that guessed would show a
 * composer that every mutation then rejects.
 */
export interface PlaygroundViewer {
  signed_in: boolean;
  can_post: boolean;
  principal_id: string;
  display_name: string;
  animal_emoji: string;
  is_guest: boolean;
}

/**
 * A post's card reference is an ID STRING, not an object. The renderable
 * card lives in the bootstrap's `cards` map, re-read by the server at render
 * time so an App that stops being public stops advertising itself.
 */
export interface PlaygroundPost {
  id: string;
  author_user_id: string;
  kind: PlaygroundPostKind;
  text: string | null;
  app_ref: string | null;
  activity_ref: string | null;
  created_at: string;
  /** emoji → count, across everyone. */
  reactions: Record<string, number>;
  /** The emoji THIS viewer has on this post. */
  viewer_reactions: string[];
  /**
   * World this post belongs to. Set on the App Room path (ops carry it);
   * absent on the legacy path, where the server filtered by World before
   * sending. Seals persist it so a restore can filter per World.
   */
  world?: PlaygroundWorldId | null;
}

/** Server-owned public projection. No owner, instance id, or invite token. */
export interface PlaygroundAppCard {
  ref: string;
  title: string;
  icon: string | null;
  thumbnail_url: string | null;
  /** Existing public App path (`/a/<slug>`) — resolved against the PWA origin. */
  app_path: string;
  usable: boolean;
}

export interface PlaygroundActivityCard {
  ref: string;
  title: string;
  status: string;
  participant_count: number | null;
  capacity: number | null;
  usable: boolean;
}

export interface PlaygroundCards {
  apps: Record<string, PlaygroundAppCard>;
  activities: Record<string, PlaygroundActivityCard>;
}

export type PlaygroundEventKind =
  | "post.created"
  | "post.deleted"
  | "reaction.added"
  | "reaction.removed";

export interface PlaygroundEvent {
  seq: number;
  operation_id: string;
  room_id: string;
  kind: PlaygroundEventKind;
  entity_id: string;
  payload: unknown;
  created_at: string;
}

export interface PlaygroundBootstrap {
  room_id: string;
  viewer: PlaygroundViewer;
  posts: PlaygroundPost[];
  cards: PlaygroundCards;
  muted_user_ids: string[];
  cursor: number;
  online: number;
}

export interface PlaygroundEventsPage {
  events: PlaygroundEvent[];
  /**
   * The high-water mark AT THE TIME OF THE READ — not `last event seq`.
   * This is what lets a client whose every event was mute-filtered still
   * learn it has caught up, instead of re-requesting the same empty range.
   */
  cursor: number;
}

/**
 * Where somebody is standing and which way they are looking.
 *
 * EPHEMERAL. This travels the presence lane only: it is never written to D1,
 * never carries a `seq`, and never advances the durable cursor. Sent at ~12Hz
 * and interpolated on arrival.
 */
export interface PlaygroundTransform {
  /**
   * Which World this position is in. It SCOPES the broadcast: the server only
   * relays a transform to sockets in the same World, which is what turns eight
   * places into eight rooms instead of one crowd wearing different scenery.
   */
  world_id: PlaygroundWorldId;
  x: number;
  /** Eye height. Honoured, not ignored — a raised deck is a real position. */
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  movement: "idle" | "walk" | "jump";
  /**
   * Sitting is a World affordance (a bench, a log), not a movement.
   * Crouching is the reporter's own posture: visual only, `y` stays
   * stand-based so pose-unaware clients keep the right feet.
   */
  pose: "stand" | "sit" | "crouch";
}

/**
 * The Worlds, mirroring ato-api's `services/lobby/world.ts` allowlist.
 *
 * Duplicated deliberately rather than imported from the 3D layer: this file
 * is the WIRE contract, and the renderer should be free to change without
 * touching what the two services agreed to send each other.
 */
export const PLAYGROUND_WORLD_IDS = [
  "central-plaza",
  "market",
  "campfire",
  "treehouse",
  "lookout",
  "meadow",
  "ruins",
  "stargazing",
] as const;

export type PlaygroundWorldId = (typeof PLAYGROUND_WORLD_IDS)[number];

/** Per-World head counts, for the selector. Global, not World-scoped. */
export type PlaygroundWorldOnline = Partial<Record<PlaygroundWorldId, number>>;

/** Person-targeted reactions. Distinct from `PlaygroundReaction`, which is
 *  the DURABLE set applied to a post; these float above a head for ~2.4s and
 *  are never persisted. */
export type PlaygroundFaceReaction = "👋" | "❤️" | "😂" | "👍";

export const PLAYGROUND_FACE_REACTIONS: readonly PlaygroundFaceReaction[] = [
  "👋",
  "❤️",
  "😂",
  "👍",
];

/** A participant as broadcast by the room. */
export interface PlaygroundParticipant {
  principal_id: string;
  display_name: string;
  animal_emoji: string;
  is_guest: boolean;
  /**
   * Which World they are in. Optional so a client keeps working against a
   * server that has not shipped the field yet — absent is read as the default
   * World rather than as "nowhere", which would make everybody vanish.
   */
  world_id?: PlaygroundWorldId;
  typing: boolean;
  /**
   * Last known transform, when the server has one. Optional because a
   * participant who has not moved yet has none, and because a client must
   * keep working against a server that has not shipped the field — the
   * avatar then spawns at the origin and corrects on the first `transform`.
   */
  transform?: PlaygroundTransform | null;
}

export const PLAYGROUND_PROTOCOL = "ato.playground@1" as const;

/**
 * Socket close code the server uses when a socket has outlived its
 * authentication. It is a normal, expected reconnect trigger — not an error
 * — because a socket authenticated once at upgrade would otherwise hold an
 * authenticated feed open indefinitely after sign-out.
 */
export const PLAYGROUND_REAUTH_CLOSE_CODE = 4001;

export type PlaygroundRoomEnvelope =
  | {
      protocol: typeof PLAYGROUND_PROTOCOL;
      kind: "hello";
      self: PlaygroundParticipant;
      online: number;
      world_online?: PlaygroundWorldOnline;
      high_water_cursor: number;
    }
  | {
      protocol: typeof PLAYGROUND_PROTOCOL;
      kind: "snapshot";
      online: number;
      world_online?: PlaygroundWorldOnline;
      participants: PlaygroundParticipant[];
    }
  | {
      protocol: typeof PLAYGROUND_PROTOCOL;
      kind: "join";
      participant: PlaygroundParticipant;
      online: number;
    }
  | {
      protocol: typeof PLAYGROUND_PROTOCOL;
      kind: "leave";
      principal_id: string;
      online: number;
    }
  | {
      protocol: typeof PLAYGROUND_PROTOCOL;
      kind: "typing";
      principal_id: string;
      typing: boolean;
    }
  | {
      protocol: typeof PLAYGROUND_PROTOCOL;
      kind: "event";
      cursor: number;
      event: PlaygroundEvent;
    }
  | {
      protocol: typeof PLAYGROUND_PROTOCOL;
      kind: "sync";
      high_water_cursor: number;
      online: number;
    }
  | ({
      protocol: typeof PLAYGROUND_PROTOCOL;
      kind: "transform";
      principal_id: string;
    } & PlaygroundTransform)
  | {
      protocol: typeof PLAYGROUND_PROTOCOL;
      kind: "face_reaction";
      from_principal_id: string;
      target_principal_id: string;
      emoji: string;
    };
