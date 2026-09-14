/**
 * Playground — one global Lobby (`global-v1`), as a first-person world.
 *
 * Three lanes, kept deliberately separate:
 *   1. Presence — where people are, which way they look, typing, and the
 *      short-lived reaction above a head. WebSocket only, never persisted.
 *   2. Social events — posts and post reactions. Durable, D1-canonical,
 *      applied through `playgroundStore`'s seq-ordered reducer. A speech
 *      bubble is a transient RENDER of a durable post, not a second store.
 *   3. App/Activity operations — when hosted as a Browser Runner, transforms
 *      use the common capability/order/dedupe/ACK path. The room socket is a
 *      standalone-host compatibility lane, not the collaboration authority.
 *
 * Identity is whatever the SERVER says in `bootstrap.viewer`. This page takes
 * no account props: it runs on a different origin from the PWA, and trusting
 * a client-side "I am signed in" would only produce controls whose every
 * mutation the server then rejects. `can_post` is the server's answer.
 *
 * React owns state; `startWorld` owns the render loop. Presence is pushed
 * into the world through an effect rather than re-rendering React at 60fps.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppRoomTransport, type AppRoomMessage } from "./roomTransport";
import {
  CATALOG_CARDS_PATH,
  PLAZA_EPHEMERAL_FACE_REACTION_KIND,
  PLAZA_EPHEMERAL_TRANSFORM_KIND,
  PLAZA_SEAL_DRIFT_OPS,
  buildSealPayload,
  mapRoomEventsPage,
  postOp,
  roomBootstrapToState,
  roomOpToEvent,
  viewerFromHello,
  worldOfParticipant,
  type AppRoomHello,
  type AppRoomParticipant,
} from "./roomProtocol";
import { pwaUrl } from "./playgroundLocation";
import {
  applyFaceReaction,
  applyJoin,
  applyLeave,
  applySnapshot,
  applySpeech,
  applyTransform,
  applyTyping,
  createPresenceState,
  enterWorld,
  expire,
  principalIdForAuthor,
  visibleMembers,
  type PresenceState,
} from "./presenceStore";
import {
  applyEventsPage,
  bufferEvent,
  createPlaygroundState,
  isBehind,
  setOnline,
  type PlaygroundState,
} from "./playgroundStore";
import type { PlaygroundParticipant } from "./types";
import {
  PLAYGROUND_FACE_REACTIONS,
  type PlaygroundFaceReaction,
  type PlaygroundWorldOnline,
} from "./types";
import { startWorld, type ExhibitCard, type WorldHandle, type WorldTarget, type WorldTransformReport } from "./world/world";
import { WORLDS } from "./world/worlds";
import { DEFAULT_WORLD_ID, type WorldId } from "./world/types";
import { ATO_BROWSER_BRIDGE_READY_EVENT } from "../shared/runnerProtocol";
import {
  createPlaygroundRunnerSync,
  playgroundFaceReactionPayload,
  playgroundPresentationPayload,
  playgroundTransformPayload,
  playgroundTypingPayload,
  PLAYGROUND_RUNNER_PROTOCOL,
  type PlaygroundRunnerState,
} from "./playgroundRunnerAdapter";
import "./playground.css";

const TEXT_LIMIT = 200;
const SIGN_IN_PATH = "/sign-in";

function parseRunnerProjection(value: unknown): PlaygroundRunnerState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const projection = value as Record<string, unknown>;
  if (!Number.isInteger(projection.revision)) return null;
  if (projection.mode === "delta") {
    return Array.isArray(projection.world_ids)
      ? (value as PlaygroundRunnerState)
      : null;
  }
  return Array.isArray(projection.members) && Array.isArray(projection.reactions)
    ? (value as PlaygroundRunnerState)
    : null;
}

/**
 * How a target is described.
 *
 * A mascot is deliberately labelled as a guide rather than as a person: it
 * looks like an inhabitant through a crosshair, and a visitor who tries to
 * talk to one should learn it is scenery before they wonder why nobody
 * answered.
 */
function targetKindLabel(target: WorldTarget): string {
  switch (target.kind) {
    case "person":
      return "NEAR YOU";
    case "mascot":
      return "GUIDE";
    case "seat":
      return "SEAT";
    default:
      return target.kind.toUpperCase();
  }
}

function targetTitle(target: WorldTarget): string {
  return target.kind === "person" || target.kind === "mascot"
    ? target.name
    : target.title;
}

function targetActionLabel(target: WorldTarget): string {
  switch (target.kind) {
    case "person":
      return "話しかける";
    case "mascot":
      return "なでる";
    case "seat":
      return "座る";
    case "app":
      return "使ってみる";
    default:
      return "参加する";
  }
}

export default function PlaygroundPage() {
  const [state, setState] = useState<PlaygroundState>(createPlaygroundState);
  const [presence, setPresence] = useState<PresenceState>(createPresenceState);
  const [target, setTarget] = useState<WorldTarget | null>(null);
  const [locked, setLocked] = useState(false);
  const [chatting, setChatting] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [worldReady, setWorldReady] = useState(false);
  const [worldId, setWorldId] = useState<WorldId>(DEFAULT_WORLD_ID);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [crouched, setCrouched] = useState(false);
  const [runnerBacked, setRunnerBacked] = useState(false);
  const [controllerPresentation, setControllerPresentation] = useState<{
    display_name: string;
    principal_id?: string;
  } | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<WorldHandle | null>(null);
  const transportRef = useRef<AppRoomTransport | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The reducer runs inside socket callbacks that close over stale state, so
  // the live cursor is read from a ref rather than the captured value.
  const stateRef = useRef(state);
  stateRef.current = state;
  // Which durable events have already produced a bubble, so a live event that
  // a catch-up also delivered does not speak twice.
  const spokenRef = useRef<Set<number>>(new Set());
  const runnerBackedRef = useRef(false);
  const runnerAvailableRef = useRef(false);
  const runnerMembersRef = useRef<Set<string>>(new Set());
  const runnerActorBySocialPrincipalRef = useRef<Map<string, string>>(new Map());
  const runnerReactionRevisionRef = useRef(0);
  const runnerPresentationRef = useRef("");
  const pendingRunnerSnapshotWorldRef = useRef<WorldId | null>(null);
  const runnerSnapshotRequestRef = useRef<(worldId: WorldId) => void>(() => undefined);
  const runnerDispatchRef = useRef<
    (protocolId: string, kind: string, payload: { type: string }) => boolean
  >(() => false);
  // ---- Room refs ----
  /** Last hello: identity + rights. */
  const helloRef = useRef<AppRoomHello | null>(null);
  /** Mirror of `worldId` state for socket callbacks closing over stale values. */
  const worldIdRef = useRef(worldId);
  worldIdRef.current = worldId;
  /** Seal base the next seal must cover from. Reset on every load. */
  const sealedBaseRef = useRef(0);
  /** Last transform, re-sent in the new scope on World change. */
  const lastTransformRef = useRef<WorldTransformReport | null>(null);
  /** Card-ref key already resolved, so posts don't refetch per render. */
  const cardsFetchedRef = useRef("");

  useEffect(() => {
    let attached = false;
    let unregister: (() => void) | undefined;
    let unsubscribeController: (() => void) | undefined;
    let unsubscribeObservation: (() => void) | undefined;
    const applyRunnerProjection = (projection: PlaygroundRunnerState) => {
      const now = performance.now();
      setPresence((current) => {
        if (projection.mode === "delta") {
          let next = current;
          if (projection.remove_actor_id) {
            runnerMembersRef.current.delete(projection.remove_actor_id);
            for (const [principalId, actorId] of runnerActorBySocialPrincipalRef.current) {
              if (actorId === projection.remove_actor_id) {
                runnerActorBySocialPrincipalRef.current.delete(principalId);
              }
            }
            next = applyLeave(
              next,
              projection.remove_actor_id,
              runnerMembersRef.current.size,
            );
          }
          if (projection.upsert) {
            runnerMembersRef.current.add(projection.upsert.actor_id);
            next = applyJoin(
              next,
              {
                principal_id: projection.upsert.actor_id,
                display_name: projection.upsert.display_name,
                animal_emoji: projection.upsert.animal_emoji,
                is_guest: projection.upsert.is_guest,
                world_id: projection.upsert.transform.world_id,
                typing: projection.upsert.typing,
                transform: projection.upsert.transform,
              },
              runnerMembersRef.current.size,
              now,
            );
            if (projection.upsert.social_principal_id) {
              runnerActorBySocialPrincipalRef.current.set(
                projection.upsert.social_principal_id,
                projection.upsert.actor_id,
              );
            }
          }
          if (projection.reaction) {
            next = applyFaceReaction(
              next,
              projection.reaction.target_actor_id,
              projection.reaction.emoji,
              now,
              projection.reaction.from_actor_id,
            );
          }
          return {
            ...next,
            online: [...next.members.values()].filter(
              (member) => member.world_id === next.worldId,
            ).length,
            worldOnline: projection.world_online ?? next.worldOnline,
          };
        }
        let next = current;
        const incoming = new Set(
          projection.members.map((member) => member.actor_id),
        );
        for (const previous of runnerMembersRef.current) {
          if (!incoming.has(previous)) {
            next = applyLeave(next, previous, Math.max(0, next.online - 1));
          }
        }
        for (const member of projection.members) {
          next = applyJoin(
            next,
            {
              principal_id: member.actor_id,
              display_name: member.display_name,
              animal_emoji: member.animal_emoji,
              is_guest: member.is_guest,
              world_id: member.transform.world_id,
              typing: member.typing,
              transform: member.transform,
            },
            incoming.size,
            now,
          );
        }
        for (const reaction of projection.reactions) {
          if (reaction.revision <= runnerReactionRevisionRef.current) continue;
          next = applyFaceReaction(
            next,
            reaction.target_actor_id,
            reaction.emoji,
            now,
            reaction.from_actor_id,
          );
          runnerReactionRevisionRef.current = reaction.revision;
        }
        runnerMembersRef.current = incoming;
        runnerActorBySocialPrincipalRef.current = new Map(
          projection.members.flatMap((member) =>
            member.social_principal_id
              ? [[member.social_principal_id, member.actor_id] as const]
              : [],
          ),
        );
        return {
          ...next,
          online: incoming.size,
          worldOnline: projection.world_online ?? next.worldOnline,
        };
      });
    };
    const setController = (controller: {
      ready: boolean;
      actor_id?: string;
      actor_presentation?: { display_name: string; principal_id?: string };
    }) => {
      runnerBackedRef.current = controller.ready;
      setRunnerBacked(controller.ready);
      setControllerPresentation(controller.actor_presentation ?? null);
      if (!controller.ready || !controller.actor_id) return;
      const viewer = stateRef.current.viewer;
      setPresence((current) => ({
        ...current,
        self: {
          principal_id: controller.actor_id!,
          display_name: viewer?.display_name ?? "",
          animal_emoji: viewer?.animal_emoji ?? "",
          is_guest: viewer?.is_guest ?? true,
          world_id: current.worldId,
          typing: false,
        },
      }));
    };
    const attach = (): void => {
      if (attached) return;
      const applicationController = window.atoApplicationController;
      const bridge = window.atoBrowserBridge;
      if (!applicationController && !bridge) return;
      attached = true;
      runnerAvailableRef.current = true;
      setPresence((current) => ({
        ...current,
        self: null,
        members: new Map(),
        online: 0,
        worldOnline: {},
      }));
      if (applicationController) {
        runnerDispatchRef.current = (protocolId, kind, payload) =>
          applicationController.dispatchOperation(protocolId, kind, payload);
        unsubscribeController = applicationController.subscribeState(setController);
        runnerSnapshotRequestRef.current = () =>
          applicationController.requestSnapshot(PLAYGROUND_RUNNER_PROTOCOL);
        unsubscribeObservation = applicationController.subscribeObservation(
          (observation) => {
            if (observation.protocol_id !== PLAYGROUND_RUNNER_PROTOCOL) return;
            const projection = parseRunnerProjection(observation.state);
            if (projection) applyRunnerProjection(projection);
          },
        );
      } else if (bridge) {
        const sync = createPlaygroundRunnerSync(applyRunnerProjection);
        unregister = bridge.registerProtocolAdapter(sync.adapter);
        runnerDispatchRef.current = (protocolId, kind, payload) =>
          bridge.dispatchOperation(protocolId, kind, payload);
        unsubscribeController = bridge.subscribeControllerState(setController);
        runnerSnapshotRequestRef.current = (nextWorld) =>
          applyRunnerProjection(sync.projection(nextWorld));
      }
    };
    attach();
    window.addEventListener(ATO_BROWSER_BRIDGE_READY_EVENT, attach);
    return () => {
      window.removeEventListener(ATO_BROWSER_BRIDGE_READY_EVENT, attach);
      runnerBackedRef.current = false;
      runnerAvailableRef.current = false;
      runnerMembersRef.current.clear();
      runnerActorBySocialPrincipalRef.current.clear();
      runnerPresentationRef.current = "";
      runnerSnapshotRequestRef.current = () => undefined;
      runnerReactionRevisionRef.current = 0;
      runnerDispatchRef.current = () => false;
      setRunnerBacked(false);
      setControllerPresentation(null);
      unsubscribeController?.();
      unsubscribeObservation?.();
      unregister?.();
    };
  }, []);

  // ---- Room backend (normal instance room) ----------------------------

  /** Map one room op through the current posts + World, then buffer it. */
  const bufferRoomOp = useCallback(
    (event: import("./roomProtocol").AppRoomOpEvent) => {
      const world = worldIdRef.current;
      setState((current) =>
        bufferEvent(current, roomOpToEvent(event, current.posts, world)),
      );
    },
    [],
  );

  /** Seal the room when this client may seal and the drift warrants it. */
  const maybeSeal = useCallback(async () => {
    const transport = transportRef.current;
    const hello = helloRef.current;
    if (!transport || !hello) return;
    if (hello.role !== "owner" && hello.role !== "editor") return;
    const drift = stateRef.current.cursor - sealedBaseRef.current;
    if (drift < PLAZA_SEAL_DRIFT_OPS) return;
    try {
      const payload = buildSealPayload(stateRef.current);
      const sealed = await transport.seal(sealedBaseRef.current, payload);
      sealedBaseRef.current = payload.cursor;
      void sealed;
    } catch {
      // base_cursor_moved / log races resolve on the next seal attempt.
    }
  }, []);

  /** Full load: seal → state, then page the suffix to the head. */
  const loadRoom = useCallback(async (opts?: { fresh?: boolean }) => {
    const transport = transportRef.current;
    const hello = helloRef.current;
    if (!transport || !hello) return;
    try {
      const boot = await transport.bootstrap();
      transport.roomEpoch = boot.room_epoch;
      sealedBaseRef.current = boot.checkpoint?.base_cursor ?? 0;
      const viewer = viewerFromHello(hello);
      setState((current) => {
        // A World switch drops in-flight live events mapped for the old
        // World; mutes are viewer-local and survive. Reconnects keep both.
        const previous = opts?.fresh
          ? { ...createPlaygroundState(), mutedUserIds: current.mutedUserIds }
          : current;
        return roomBootstrapToState(
          previous,
          viewer,
          boot.checkpoint_payload,
          0,
          worldIdRef.current,
        );
      });
      setError(null);
      await catchUpRoomRef.current();
      void fetchCardsRef.current();
    } catch {
      setError("Playground を読み込めませんでした。");
    }
  }, []);

  /** Replay the suffix to the head, paging 200-event windows. */
  const catchUpRoom = useCallback(async () => {
    const transport = transportRef.current;
    if (!transport) return;
    try {
      for (let pages = 0; pages < 25; pages += 1) {
        const from = stateRef.current.cursor;
        const page = await transport.events(from);
        transport.roomEpoch = page.room_epoch;
        const world = worldIdRef.current;
        setState((current) =>
          applyEventsPage(
            current,
            mapRoomEventsPage(page.events, current.posts, world),
            page.high_water_cursor,
          ),
        );
        if (page.high_water_cursor <= stateRef.current.cursor) break;
        if (page.events.length === 0) break;
      }
    } catch {
      // A failed catch-up is not fatal: the next event or sync retries it.
    }
  }, []);
  const catchUpRoomRef = useRef(catchUpRoom);
  catchUpRoomRef.current = catchUpRoom;

  /** Resolve card refs found in posts against the public catalogue. */
  const fetchCards = useCallback(async () => {
    const transport = transportRef.current;
    if (!transport) return;
    const apps = new Set<string>();
    const activities = new Set<string>();
    for (const post of stateRef.current.posts.values()) {
      if (post.app_ref) apps.add(post.app_ref);
      if (post.activity_ref) activities.add(post.activity_ref);
    }
    if (apps.size === 0 && activities.size === 0) return;
    const key = [...apps].sort().join(",") + "|" + [...activities].sort().join(",");
    if (cardsFetchedRef.current === key) return;
    cardsFetchedRef.current = key;
    try {
      const params = new URLSearchParams();
      for (const ref of apps) params.append("app", ref);
      for (const ref of activities) params.append("activity", ref);
      const response = await fetch(
        `${CATALOG_CARDS_PATH}?${params.toString()}`,
        { credentials: "same-origin", cache: "no-store" },
      );
      if (!response.ok) return;
      const cards = (await response.json()) as PlaygroundState["cards"];
      if (!cards || typeof cards !== "object") return;
      setState((current) => ({
        ...current,
        cards: {
          apps: { ...current.cards.apps, ...(cards.apps ?? {}) },
          activities: { ...current.cards.activities, ...(cards.activities ?? {}) },
        },
      }));
    } catch {
      // Cards are enhancement; posts stay readable without them.
    }
  }, []);
  const fetchCardsRef = useRef(fetchCards);
  fetchCardsRef.current = fetchCards;

  useEffect(() => {
    const viewer = state.viewer;
    const displayName = viewer?.display_name ?? controllerPresentation?.display_name;
    if (!runnerBacked || !displayName) return;
    const signature = JSON.stringify([
      viewer?.principal_id,
      displayName,
      viewer?.animal_emoji,
      viewer?.is_guest,
    ]);
    if (runnerPresentationRef.current === signature) return;
    if (
      runnerDispatchRef.current(
        PLAYGROUND_RUNNER_PROTOCOL,
        "presentation",
        playgroundPresentationPayload({
          display_name: displayName,
          animal_emoji: viewer?.animal_emoji ?? "🙂",
          is_guest: viewer?.is_guest ?? true,
          ...(viewer?.principal_id
            ? { social_principal_id: viewer.principal_id }
            : controllerPresentation?.principal_id
              ? { social_principal_id: controllerPresentation.principal_id }
              : {}),
        }),
      )
    ) runnerPresentationRef.current = signature;
  }, [controllerPresentation, runnerBacked, state.viewer]);

  // ---- durable lane + presence lane, one socket --------------------------

  // ---- durable lane + presence lane, one socket --------------------------

  useEffect(() => {
    const toParticipant = (
      participant: AppRoomParticipant,
    ): PlaygroundParticipant => ({
      principal_id: participant.principal_id,
      display_name: participant.display_name,
      animal_emoji: participant.animal_emoji,
      is_guest: participant.principal_id.startsWith("guest:"),
      world_id: worldOfParticipant(participant, worldIdRef.current),
      typing: participant.typing,
    });
    const worldOnlineOf = (
      participants: readonly AppRoomParticipant[],
    ): PlaygroundWorldOnline => {
      const counts: PlaygroundWorldOnline = {};
      for (const participant of participants) {
        const world = worldOfParticipant(participant, worldIdRef.current);
        counts[world] = (counts[world] ?? 0) + 1;
      }
      return counts;
    };
    const transport = new AppRoomTransport({
      onConnected: () => setConnected(true),
      onDisconnected: () => setConnected(false),
      onReconnected: () => {
        void loadRoom().then(() => catchUpRoomRef.current());
      },
      onMessage: (message: AppRoomMessage) => {
        const now = performance.now();
        switch (message.kind) {
          case "hello":
            helloRef.current = message;
            setConnected(true);
            setState((current) => ({
              ...current,
              viewer: viewerFromHello(message),
            }));
            setState((current) => setOnline(current, message.online));
            void loadRoom();
            break;
          case "snapshot":
            if (runnerAvailableRef.current) break;
            setPresence((current) =>
              applySnapshot(
                current,
                message.participants.map(toParticipant),
                message.online,
                now,
                worldOnlineOf(message.participants),
              ),
            );
            setState((current) => setOnline(current, message.online));
            break;
          case "join":
            if (runnerAvailableRef.current) break;
            setPresence((current) =>
              applyJoin(current, toParticipant(message.participant), message.online, now),
            );
            setState((current) => setOnline(current, message.online));
            break;
          case "leave":
            if (runnerAvailableRef.current) break;
            setPresence((current) =>
              applyLeave(current, message.principal_id, message.online),
            );
            setState((current) => setOnline(current, message.online));
            break;
          case "presence":
            if (runnerAvailableRef.current) break;
            setPresence((current) =>
              applyTyping(current, message.principal_id, message.payload.typing ?? false),
            );
            break;
          case "ephemeral": {
            if (runnerAvailableRef.current) break;
            const payload = message.ephemeral.payload as Record<string, unknown>;
            if (message.ephemeral.kind === PLAZA_EPHEMERAL_TRANSFORM_KIND) {
              setPresence((current) =>
                applyTransform(current, message.principal_id, payload, now),
              );
            } else if (
              message.ephemeral.kind === PLAZA_EPHEMERAL_FACE_REACTION_KIND &&
              typeof payload.target_principal_id === "string" &&
              typeof payload.emoji === "string" &&
              (PLAYGROUND_FACE_REACTIONS as readonly string[]).includes(payload.emoji)
            ) {
              setPresence((current) =>
                applyFaceReaction(
                  current,
                  payload.target_principal_id as string,
                  payload.emoji as string,
                  now,
                  message.principal_id,
                ),
              );
            }
            break;
          }
          case "event": {
            bufferRoomOp(message.event);
            if (
              message.event.op &&
              typeof message.event.op === "object" &&
              (message.event.op as { t?: unknown }).t === "post"
            ) {
              const payload = (message.event.op as { post?: Record<string, unknown> }).post;
              if (
                payload &&
                payload.kind === "text" &&
                typeof payload.text === "string" &&
                payload.text &&
                !spokenRef.current.has(message.event.seq) &&
                !stateRef.current.mutedUserIds.has(message.event.actor_id)
              ) {
                spokenRef.current.add(message.event.seq);
                setPresence((current) =>
                  applySpeech(
                    current,
                    runnerAvailableRef.current
                      ? runnerActorBySocialPrincipalRef.current.get(
                          principalIdForAuthor(message.event.actor_id),
                        ) ?? principalIdForAuthor(message.event.actor_id)
                      : principalIdForAuthor(message.event.actor_id),
                    payload.text as string,
                    now,
                  ),
                );
              }
            }
            break;
          }
          case "sync":
            if (isBehind(stateRef.current, message.high_water_cursor)) {
              void catchUpRoomRef.current();
            }
            break;
          case "checkpoint_requested":
            void maybeSeal();
            break;
          case "reset":
            spokenRef.current = new Set();
            void loadRoom();
            break;
        }
      },
      onError: () => setConnected(false),
    });
    transportRef.current = transport;
    transport.connect();
    return () => {
      transport.close();
      transportRef.current = null;
    };
  }, [bufferRoomOp, loadRoom, maybeSeal]);

  // Signing in happens on the PWA origin; the session cookie is scoped to the
  // parent domain, so coming back to this tab is enough. Re-bootstrap on
  // focus so the controls unlock without a manual reload.
  useEffect(() => {
    const onFocus = () => void loadRoom();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadRoom]);

  // ---- world -------------------------------------------------------------

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let world: WorldHandle;
    try {
      world = startWorld(host, {
        onPointerLockChange: setLocked,
        onTargetChange: setTarget,
        onTransform: (transform) => {
          if (runnerAvailableRef.current) {
            try {
              const sent = runnerDispatchRef.current(
                PLAYGROUND_RUNNER_PROTOCOL,
                "transform",
                playgroundTransformPayload(transform),
              );
              if (
                sent &&
                pendingRunnerSnapshotWorldRef.current === transform.world_id
              ) {
                pendingRunnerSnapshotWorldRef.current = null;
                runnerSnapshotRequestRef.current(transform.world_id);
              }
              return;
            } catch {
              // The common Runner may be reconnecting. A stale transform is
              // intentionally dropped rather than leaking into another lane.
              return;
            }
          }
          lastTransformRef.current = transform;
          // Fire-and-forget: a transform is only interesting until the
          // next one (~12Hz into a 15/s shared transient budget;
          // over-budget frames drop server-side).
          transportRef.current?.sendEphemeral(
              PLAZA_EPHEMERAL_TRANSFORM_KIND,
              transform.world_id,
              {
                x: transform.x,
                y: transform.y,
                z: transform.z,
                yaw: transform.yaw,
                pitch: transform.pitch,
                movement: transform.movement,
                pose: transform.pose,
              },
              5000,
          );
        },
        onRequestChat: () => setChatting(true),
        onInteract: (item) => {
          if (item.kind === "person") {
            setChatting(true);
            return;
          }
          // Mascots and seats never reach here — the World handles its own
          // local affordances, so this page only ever opens Software.
          if (item.kind !== "app" && item.kind !== "activity") return;
          const card =
            item.kind === "app"
              ? stateRef.current.cards.apps[item.ref]
              : stateRef.current.cards.activities[item.ref];
          if (!card || !card.usable) {
            setError("これはいま利用できません。");
            return;
          }
          const path =
            item.kind === "app"
              ? (card as { app_path: string }).app_path
              : `/activity/${encodeURIComponent(item.ref)}`;
          const href = pwaUrl(path);
          if (!href) {
            setError("リンク先を解決できませんでした。");
            return;
          }
          // A different origin, so a new tab — same rule the PWA's own App
          // tiles follow.
          window.open(href, "_blank", "noopener");
        },
        onFaceReaction: (principalId, emoji) => {
          if (runnerAvailableRef.current) {
            try {
              runnerDispatchRef.current(
                PLAYGROUND_RUNNER_PROTOCOL,
                "face_reaction",
                playgroundFaceReactionPayload(
                  principalId,
                  emoji as PlaygroundFaceReaction,
                ),
              );
            } catch {
              // Reactions are ephemeral and are not retried after reconnect.
            }
            return;
          }
          transportRef.current?.sendEphemeral(
              PLAZA_EPHEMERAL_FACE_REACTION_KIND,
              worldIdRef.current,
              { target_principal_id: principalId, emoji },
              2400,
            );
        },
        onWorldChange: (next) => {
          setWorldId(next);
          setCrouched(false);
          // Clear the roster and re-read the durable lane: posts are
          // World-scoped too, so the previous World's conversation must not
          // follow you into the next one.
          setPresence((current) => enterWorld(current, next));
          pendingRunnerSnapshotWorldRef.current = next;
          {
            // Resubscribe delivery to the new World immediately: the room
            // only relays a scope to sockets that sent it, and an idle
            // avatar may not move for a while.
            const last = lastTransformRef.current;
            if (last) {
              transportRef.current?.sendEphemeral(
                PLAZA_EPHEMERAL_TRANSFORM_KIND,
                next,
                {
                  x: last.x,
                  y: last.y,
                  z: last.z,
                  yaw: last.yaw,
                  pitch: last.pitch,
                  movement: last.movement,
                  pose: last.pose,
                },
                5000,
              );
            }
            void loadRoom({ fresh: true });
          }
        },
        onError: setError,
      });
    } catch {
      setError(
        "3D表示を開始できませんでした。WebGL に対応したブラウザで開いてください。",
      );
      return;
    }
    worldRef.current = world;
    setWorldReady(true);
    return () => {
      world.dispose();
      worldRef.current = null;
      setWorldReady(false);
    };
  }, []);

  // Push presence into the world. Expiry runs here rather than on a timer:
  // it only matters when something is being drawn.
  useEffect(() => {
    worldRef.current?.setPresence(
      visibleMembers(presence),
      presence.self?.principal_id ?? state.viewer?.principal_id ?? null,
    );
  }, [presence, state.viewer]);

  useEffect(() => {
    const handle = window.setInterval(() => {
      setPresence((current) => expire(current, performance.now()));
    }, 1000);
    return () => window.clearInterval(handle);
  }, []);

  const exhibits = useMemo<ExhibitCard[]>(() => {
    const apps = Object.values(state.cards.apps).map((card) => ({
      ref: card.ref,
      kind: "app" as const,
      title: card.title,
      subtitle: card.usable ? "使ってみる" : "いま利用できません",
    }));
    const activities = Object.values(state.cards.activities).map((card) => ({
      ref: card.ref,
      kind: "activity" as const,
      title: card.title,
      subtitle:
        card.participant_count !== null
          ? `${card.participant_count} people`
          : "参加する",
    }));
    return [...apps, ...activities];
  }, [state.cards]);

  useEffect(() => {
    worldRef.current?.setExhibits(exhibits);
  }, [exhibits]);

  // Chat and pointer lock are mutually exclusive: a locked pointer swallows
  // the keystrokes the composer needs.
  useEffect(() => {
    worldRef.current?.setPaused(chatting);
    if (chatting) {
      document.exitPointerLock?.();
      const handle = window.setTimeout(() => inputRef.current?.focus(), 30);
      return () => window.clearTimeout(handle);
    }
  }, [chatting]);

  const viewer = state.viewer;
  const canPost = viewer?.can_post === true;
  const remaining = TEXT_LIMIT - [...draft].length;

  const closeChat = useCallback(() => {
    setChatting(false);
    if (runnerAvailableRef.current) {
      try {
        runnerDispatchRef.current(
          PLAYGROUND_RUNNER_PROTOCOL,
          "typing",
          playgroundTypingPayload(false),
        );
      } catch {
        // Typing is ephemeral and is not retried after reconnect.
      }
    } else {
      transportRef.current?.sendPresence({ type: "typing", typing: false });
    }
    worldRef.current?.setPaused(false);
    worldRef.current?.requestPointerLock();
  }, []);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const text = draft.trim();
      if (!text || !canPost || remaining < 0) {
        closeChat();
        return;
      }
      setDraft("");
      try {
        const { op } = postOp(text, worldIdRef.current);
        await transportRef.current?.mutate(op);
        await catchUpRoom();
        await maybeSeal();
        void fetchCardsRef.current();
      } catch {
        setError("投稿できませんでした。");
      }
      closeChat();
    },
    [draft, canPost, remaining, catchUpRoom, closeChat, maybeSeal],
  );

  const online = runnerAvailableRef.current
    ? presence.online
    : state.online || presence.online;
  const world = WORLDS.find((entry) => entry.id === worldId) ?? WORLDS[0];

  return (
    <main
      className="pg"
      data-collaboration-path={
        runnerBacked
          ? "runner"
          : runnerAvailableRef.current
            ? "runner-connecting"
            : "standalone-room"
      }
    >
      <div className="pg-world" ref={hostRef} />

      <header className="pg-topbar">
        <span className="pg-brand">
          ato<span className="pg-brand-dot">.</span>
          <span className="pg-brand-sub">plaza</span>
        </span>
        <button
          type="button"
          className="pg-room"
          aria-haspopup="dialog"
          aria-expanded={selectorOpen}
          onClick={() => setSelectorOpen((open) => !open)}
        >
          <span
            className={`pg-live${
              (runnerAvailableRef.current ? runnerBacked : connected)
                ? ""
                : " pg-live--off"
            }`}
            aria-hidden="true"
          />
          {world.name}
          <span className="pg-room-index">
            {String(world.index).padStart(2, "0")}
          </span>
          <span className="pg-room-count">{online}</span>
        </button>
      </header>

      {selectorOpen ? (
        <>
          {/* A full-screen backdrop, so clicking the world dismisses the
              panel instead of walking while it is open. */}
          <button
            type="button"
            className="pg-selector-backdrop"
            aria-label="閉じる"
            onClick={() => setSelectorOpen(false)}
          />
          <div className="pg-selector" role="dialog" aria-label="ワールドを選ぶ">
            <h2>ワールド</h2>
            <ul>
              {WORLDS.map((definition) => {
                const count = presence.worldOnline[definition.id];
                const here = definition.id === worldId;
                return (
                  <li key={definition.id}>
                    <button
                      type="button"
                      className={`pg-selector-item${here ? " pg-selector-item--here" : ""}`}
                      disabled={!definition.available || here}
                      onClick={() => {
                        setSelectorOpen(false);
                        worldRef.current?.enterWorld(definition.id);
                      }}
                    >
                      <span className="pg-selector-index">
                        {String(definition.index).padStart(2, "0")}
                      </span>
                      <span className="pg-selector-body">
                        <strong>{definition.name}</strong>
                        <small>{definition.tagline}</small>
                      </span>
                      <span className="pg-selector-count">
                        {!definition.available
                          ? "準備中"
                          : here
                            ? "ここにいます"
                            : /* An absent count is not zero: a server that has
                                 not shipped per-World counts yet would
                                 otherwise report every World as empty. */
                              typeof count === "number"
                              ? `${count}人`
                              : "—"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      ) : null}

      <div className="pg-crosshair" aria-hidden="true">
        +
      </div>

      {/* Somebody reacted at YOU. Every other reaction floats above its
          target's head, but the viewer has no avatar of their own in a
          first-person view, so this is the only place it can appear.
          `role="status"` so it is announced rather than being a purely
          visual event a screen-reader user never learns about. */}
      {presence.selfReaction ? (
        <div className="pg-self-reaction" role="status">
          <span className="pg-self-reaction-emoji" aria-hidden="true">
            {presence.selfReaction.emoji}
          </span>
          <span className="pg-self-reaction-from">
            {presence.selfReaction.from_display_name
              ? `${presence.selfReaction.from_animal_emoji} ${presence.selfReaction.from_display_name} から`
              : "あなたへ"}
          </span>
        </div>
      ) : null}

      {target && !chatting ? (
        <div className="pg-interaction">
          <span className="pg-interaction-kind">{targetKindLabel(target)}</span>
          <strong>{targetTitle(target)}</strong>
          <button
            type="button"
            onClick={() => worldRef.current?.interactWithTarget()}
          >
            {targetActionLabel(target)}
            <kbd>E</kbd>
          </button>
        </div>
      ) : null}

      {!locked && !chatting ? (
        <button
          type="button"
          className="pg-enter"
          disabled={!worldReady}
          onClick={() => worldRef.current?.requestPointerLock()}
        >
          {worldReady ? "クリックして探索する" : "広場を準備しています…"}
        </button>
      ) : null}

      <div className="pg-reactions" role="group" aria-label="リアクション">
        {PLAYGROUND_FACE_REACTIONS.map((emoji, index) => (
          <button
            key={emoji}
            type="button"
            title={`${index + 1} · 見ている相手にリアクション`}
            disabled={!canPost}
            onClick={() => worldRef.current?.reactAtTarget(emoji)}
          >
            <span aria-hidden="true">{emoji}</span>
            <kbd>{index + 1}</kbd>
          </button>
        ))}
      </div>

      <footer className="pg-bottom">
        <div className="pg-identity">
          <span className="pg-identity-emoji" aria-hidden="true">
            {viewer?.animal_emoji ?? "…"}
          </span>
          <div>
            <strong>{viewer?.display_name ?? "接続中"}</strong>
            <small>{connected ? "広場に参加中" : "再接続しています…"}</small>
          </div>
        </div>
        <div className="pg-keys" aria-hidden="true">
          <span>
            <kbd>W</kbd>
            <kbd>A</kbd>
            <kbd>S</kbd>
            <kbd>D</kbd> 移動
          </span>
          <span>
            <kbd>Space</kbd> ジャンプ
          </span>
          <span>
            <kbd>C</kbd> しゃがむ
          </span>
          <span>マウス 視点</span>
          <span>
            <kbd>esc</kbd> 解除
          </span>
        </div>
        {canPost ? (
          <button
            type="button"
            className="pg-chat-open"
            onClick={() => setChatting(true)}
          >
            話す<kbd>↵</kbd>
          </button>
        ) : (
          <a className="pg-chat-open" href={pwaUrl(SIGN_IN_PATH) ?? SIGN_IN_PATH}>
            サインインして話す
          </a>
        )}
      </footer>

      <MobileJoystick onChange={(x, y) => worldRef.current?.setJoystick(x, y)} />

      <div className="pg-actions">
        <button
          type="button"
          className={`pg-action${crouched ? " pg-action--active" : ""}`}
          aria-pressed={crouched}
          aria-label="しゃがむ"
          onClick={() =>
            setCrouched((previous) => {
              const next = !previous;
              worldRef.current?.setCrouching(next);
              return next;
            })
          }
        >
          しゃがむ
        </button>
        <button
          type="button"
          className="pg-action"
          aria-label="ジャンプ"
          onClick={() => worldRef.current?.jump()}
        >
          ジャンプ
        </button>
      </div>

      {chatting ? (
        <form className="pg-compose" onSubmit={submit}>
          <input
            ref={inputRef}
            aria-label="メッセージ"
            placeholder={
              target?.kind === "person"
                ? `${target.name} の近くで話す…`
                : "近くのみんなに話す…"
            }
            value={draft}
            maxLength={TEXT_LIMIT}
            onChange={(event) => {
              setDraft(event.target.value);
              const typing = event.target.value.length > 0;
              if (runnerAvailableRef.current) {
                try {
                  runnerDispatchRef.current(
                    PLAYGROUND_RUNNER_PROTOCOL,
                    "typing",
                    playgroundTypingPayload(typing),
                  );
                } catch {
                  // Typing is ephemeral and is not retried after reconnect.
                }
              } else {
                transportRef.current?.sendPresence({ type: "typing", typing });
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") closeChat();
            }}
          />
          <span className={`pg-remaining${remaining < 0 ? " pg-remaining--over" : ""}`}>
            {remaining}
          </span>
          <button type="submit" disabled={!canPost || !draft.trim() || remaining < 0}>
            送信
          </button>
          <button type="button" onClick={closeChat} aria-label="閉じる">
            ✕
          </button>
        </form>
      ) : null}

      {error ? (
        <div className="pg-notice" role="status">
          {error}
          <button type="button" onClick={() => setError(null)} aria-label="閉じる">
            ✕
          </button>
        </div>
      ) : null}
    </main>
  );
}

/**
 * Touch-only movement stick.
 *
 * Rendered by React but driven imperatively: the thumb position changes every
 * pointermove, and routing that through state would re-render the page
 * (and its world-pushing effects) dozens of times a second.
 */
function MobileJoystick({
  onChange,
}: {
  onChange: (x: number, y: number) => void;
}) {
  const baseRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef(-1);

  const move = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerId !== pointerRef.current) return;
      const base = baseRef.current;
      if (!base) return;
      const rect = base.getBoundingClientRect();
      let x = event.clientX - rect.left - rect.width / 2;
      let y = event.clientY - rect.top - rect.height / 2;
      const length = Math.hypot(x, y);
      const radius = 34;
      if (length > radius) {
        x *= radius / length;
        y *= radius / length;
      }
      if (stickRef.current) {
        stickRef.current.style.transform = `translate(${x}px, ${y}px)`;
      }
      onChange(x / radius, -y / radius);
    },
    [onChange],
  );

  const end = useCallback(() => {
    pointerRef.current = -1;
    if (stickRef.current) stickRef.current.style.transform = "";
    onChange(0, 0);
  }, [onChange]);

  return (
    <div
      className="pg-joystick"
      ref={baseRef}
      aria-hidden="true"
      onPointerDown={(event) => {
        pointerRef.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        move(event);
      }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div ref={stickRef} />
    </div>
  );
}
