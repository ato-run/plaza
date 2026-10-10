import { encounterTitle, DISCOVERIES } from "./world/openAir/notebook";
import {
  actionWasApplied,
  committedNotice,
  interactionError,
} from "./world/openAir/feedback";
import {
  beginVisualInput,
  measureInteraction,
  interactionMeasurements,
} from "./world/openAir/metrics";
import { PLAZA_ROOM_SCHEMA_ID } from "./roomProtocol";
import { ExploreControls } from "./ExploreControls";
import {
  emptyOpenAir,
  applyOpenAir,
  restoreOpenAir,
  activeLease,
  heldItem,
  type OpenAirAction,
  type OpenAirState,
  type ResidentId,
} from "./world/openAir/model";
import { readSettings, type ExploreSettings } from "./world/openAir/settings";
import type { ExploreStatus } from "./world/openAir/scene";
import { isConversationTarget } from "./world/interaction";
import { conversationNpc } from "./conversationTarget";
import { CoopControls } from "./coop/CoopControls";
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
import { GuideDialog } from "./guide/GuideDialog";
import {
  isNpcId,
  npcProfile,
  residentGreeting,
  type NpcId,
} from "./guide/knowledge";
import {
  ENTRY_CHOICES,
  PLACE_BY_ID,
  PRACTICE_PROMPTS,
  reply as guideReply,
  SUCCESS_LINE,
  type GuideAction,
  type GuideContext,
  type GuideReply,
  type PracticeSkill,
} from "./guide/nagi";
import { PlazaMenu, type MenuSection } from "./PlazaMenu";

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
import {
  startWorld,
  type ExhibitCard,
  type WorldHandle,
  type WorldTarget,
  type WorldTransformReport,
} from "./world/world";
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
  return Array.isArray(projection.members) &&
    Array.isArray(projection.reactions)
    ? (value as PlaygroundRunnerState)
    : null;
}

/**
 * How a target is described.
 *
 * A mascot (a resident) is labelled as a neighbor rather than as a person:
 * talking to one opens a conversation with a character, not with somebody
 * else in the plaza, and the label says so before you start.
 */

function targetTitle(target: WorldTarget): string {
  return target.kind === "person" ||
    target.kind === "mascot" ||
    target.kind === "guide"
    ? target.name
    : target.title;
}

function targetActionLabel(target: WorldTarget): string {
  switch (target.kind) {
    case "object":
      return "Interact";
    case "seat":
      return "Sit";
    case "app":
      return "Try";
    default:
      return "Join";
  }
}

/** localStorage key for the viewer's chosen time of day. */
const TIME_OF_DAY_KEY = "plaza.timeOfDay";
/** localStorage key for the name and animal this viewer chose. */
const IDENTITY_KEY = "plaza.identity";

function storedIdentity(): {
  display_name: string;
  animal_emoji: string;
} | null {
  try {
    const raw = window.localStorage.getItem(IDENTITY_KEY);
    const value = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    return value &&
      typeof value.display_name === "string" &&
      typeof value.animal_emoji === "string"
      ? { display_name: value.display_name, animal_emoji: value.animal_emoji }
      : null;
  } catch {
    return null;
  }
}

export default function PlaygroundPage() {
  const [state, setState] = useState<PlaygroundState>(createPlaygroundState);
  const [presence, setPresence] = useState<PresenceState>(createPresenceState);
  const [target, setTarget] = useState<WorldTarget | null>(null);
  const targetRef = useRef(target);
  targetRef.current = target;
  const [locked, setLocked] = useState(false);
  const [exploreHintSeen, setExploreHintSeen] = useState(false);
  const [exploreHint, setExploreHint] = useState(false);
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [lookMode, setLookMode] = useState<"lock" | "drag">("lock");
  // How the place is lit for THIS viewer; remembered locally, never sent.
  const [timeOfDay, setTimeOfDay] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(TIME_OF_DAY_KEY);
    } catch {
      return null;
    }
  });
  const [chatting, setChatting] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [worldReady, setWorldReady] = useState(false);
  const [worldId, setWorldId] = useState<WorldId>(DEFAULT_WORLD_ID);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuFocus, setMenuFocus] = useState<MenuSection>("profile");
  const openMenu = useCallback((section: MenuSection) => {
    setMenuFocus(section);
    setMenuOpen(true);
  }, []);
  useEffect(() => {
    if (connected) window.atoStartup.mark("connected");
  }, [connected]);
  useEffect(() => {
    if (!menuOpen) return;
    const frame = requestAnimationFrame(() =>
      window.atoStartup.mark("first-action"),
    );
    return () => cancelAnimationFrame(frame);
  }, [menuOpen]);
  const identityTimeoutRef = useRef<number | undefined>(undefined);

  // ---- Conversations (Nagi and the residents), lessons and journeys -------
  /** A conversation is open; `talkingTo` says with whom. */
  const [guideOpen, setGuideOpen] = useState(false);
  const allPostsRef = useRef(createPlaygroundState());
  const allPostsPendingRef = useRef(
    new Map<number, import("./roomProtocol").AppRoomOpEvent>(),
  );
  const processAllPosts = useCallback(
    (events: import("./roomProtocol").AppRoomOpEvent[]) => {
      const pending = allPostsPendingRef.current;
      for (const event of events)
        if (event.seq > allPostsRef.current.cursor)
          pending.set(event.seq, event);
      let next = pending.get(allPostsRef.current.cursor + 1);
      while (next) {
        pending.delete(next.seq);
        allPostsRef.current = bufferEvent(
          allPostsRef.current,
          roomOpToEvent(next, allPostsRef.current.posts, null),
        );
        next = pending.get(allPostsRef.current.cursor + 1);
      }
    },
    [],
  );
  const openAirRef = useRef<OpenAirState>(emptyOpenAir());
  const openAirPendingRef = useRef(
    new Map<number, import("./roomProtocol").AppRoomOpEvent>(),
  );
  const clockOffsetRef = useRef(0);
  const [exploreStatus, setExploreStatus] = useState<ExploreStatus | null>(
    null,
  );
  const [settings, setSettings] = useState<ExploreSettings>(readSettings);
  const pendingActionsRef = useRef(
    new Map<
      string,
      { action: OpenAirAction; started: number; quiet: boolean }
    >(),
  );
  const showInteractionFeedback = useCallback(
    (message: string, pending = false) => {
      worldRef.current?.feedback(message, pending);
      setExploreStatus(worldRef.current?.exploreStatus() ?? null);
    },
    [],
  );
  const sendOpenAirRef = useRef<(action: OpenAirAction) => void>(() => {});
  const syncOpenAir = useCallback(() => {
    worldRef.current?.setOpenAir(
      openAirRef.current,
      stateRef.current.viewer?.principal_id ?? "",
      clockOffsetRef.current,
      connectedRef.current,
    );
  }, []);
  const connectedRef = useRef(false);
  connectedRef.current = connected;
  const processOpenAir = useCallback(
    (events: import("./roomProtocol").AppRoomOpEvent[]) => {
      const pending = openAirPendingRef.current;
      for (const event of events)
        if (event.seq > openAirRef.current.cursor)
          pending.set(event.seq, event);
      let event = pending.get(openAirRef.current.cursor + 1);
      while (event) {
        pending.delete(event.seq);
        const op = event.op as { t?: string; action?: unknown } | null;
        const before = openAirRef.current;
        openAirRef.current = applyOpenAir(
          openAirRef.current,
          event.seq,
          event.actor_id,
          event.committed_at ?? Date.now() + clockOffsetRef.current,
          event.state_schema_id === PLAZA_ROOM_SCHEMA_ID &&
            typeof event.committed_at === "number" &&
            op?.t === "openair"
            ? op.action
            : null,
        );
        const interaction = pendingActionsRef.current.get(event.operation_id);
        if (
          interaction &&
          event.actor_id === stateRef.current.viewer?.principal_id
        ) {
          pendingActionsRef.current.delete(event.operation_id);
          const success = actionWasApplied(
            before,
            openAirRef.current,
            event.actor_id,
            interaction.action,
          );
          if (!interaction.quiet) {
            showInteractionFeedback(
              success
                ? committedNotice(interaction.action)
                : "The object or neighbor changed. Move closer and try again.",
            );
            measureInteraction(
              `${interaction.action.kind}:commit`,
              interaction.started,
            );
          }
        }
        event = pending.get(openAirRef.current.cursor + 1);
      }
      syncOpenAir();
    },
    [syncOpenAir, showInteractionFeedback],
  );
  const [talkingTo, setTalkingTo] = useState<NpcId>("nagi");
  const [guideStart, setGuideStart] = useState<GuideReply | null>(null);
  const guideTalkedRef = useRef(false);
  /** A line from Nagi shown in the HUD while you practise or travel. */
  const [guideNote, setGuideNote] = useState<string | null>(null);
  const escortIntentRef = useRef<string | null>(null);
  const guideTaskRef = useRef<
    | {
        kind: "practice";
        skill: PracticeSkill;
        from: { x: number; y: number; z: number; yaw: number };
        done?: boolean;
      }
    | { kind: "go"; place: string }
    | null
  >(null);
  const openGuide = useCallback(() => {
    const first = !guideTalkedRef.current;
    guideTalkedRef.current = true;
    // First time: her greeting. After that: straight to "how can I help".
    setGuideStart(
      first
        ? null
        : {
            text: "Hello again. What can I help you with?",
            choices: [...ENTRY_CHOICES],
          },
    );
    setTalkingTo("nagi");
    setGuideOpen(true);
  }, []);
  const openGuideRef = useRef(openGuide);
  openGuideRef.current = openGuide;
  const openNeighbor = useCallback((id: string) => {
    if (!isNpcId(id) || id === "nagi") return;
    const lease = activeLease(
      openAirRef.current,
      id as ResidentId,
      Date.now() + clockOffsetRef.current,
    );
    if (lease && lease.owner !== stateRef.current.viewer?.principal_id) {
      setError(
        "This neighbor is already talking to someone. Try another neighbor.",
      );
      return;
    }
    const last = (
      openAirRef.current.encounters[
        stateRef.current.viewer?.principal_id ?? ""
      ] ?? []
    )
      .filter((e) => e.id === id)
      .slice(-1)[0];
    setGuideStart(
      last && Date.now() + clockOffsetRef.current - last.at < 900000
        ? {
            text: `Hello again. ${encounterTitle(id, last.kind)}. Shall we try something else together?`,
            choices: residentGreeting(id, Date.now() / 1000).choices,
          }
        : (() => {
            const observations =
              openAirRef.current.observations[
                stateRef.current.viewer?.principal_id ?? ""
              ] ?? [];
            const latest = observations.at(-1);
            const greeting = residentGreeting(id, Date.now() / 1000);
            return latest && DISCOVERIES[latest]
              ? {
                  ...greeting,
                  text: `You explored ${DISCOVERIES[latest].title.toLowerCase()}. ${DISCOVERIES[latest].hint}`,
                }
              : greeting;
          })(),
    );
    setTalkingTo(id);
    setGuideOpen(true);
  }, []);
  const openNeighborRef = useRef(openNeighbor);
  openNeighborRef.current = openNeighbor;
  const openMenuRef = useRef(openMenu);
  const toggleCrouch = useCallback(() => {
    setCrouched((previous) => {
      const next = !previous;
      worldRef.current?.setCrouching(next);
      return next;
    });
  }, []);
  openMenuRef.current = openMenu;
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
  const runnerActorBySocialPrincipalRef = useRef<Map<string, string>>(
    new Map(),
  );
  const runnerReactionRevisionRef = useRef(0);
  const runnerPresentationRef = useRef("");
  const pendingRunnerSnapshotWorldRef = useRef<WorldId | null>(null);
  const runnerSnapshotRequestRef = useRef<(worldId: WorldId) => void>(
    () => undefined,
  );
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
            for (const [
              principalId,
              actorId,
            ] of runnerActorBySocialPrincipalRef.current) {
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
        unsubscribeController =
          applicationController.subscribeState(setController);
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
      processOpenAir([event]);
      processAllPosts([event]);
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
      if (allPostsRef.current.cursor !== stateRef.current.cursor) return;
      const payload = buildSealPayload(allPostsRef.current, openAirRef.current);
      const sealed = await transport.seal(payload.cursor, payload);
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
      if (typeof boot.server_time_ms === "number")
        clockOffsetRef.current = boot.server_time_ms - Date.now();
      const sealed = boot.checkpoint_payload as { open_air?: unknown } | null;
      openAirRef.current = restoreOpenAir(
        boot.adapter_states?.[PLAZA_ROOM_SCHEMA_ID] ??
          (boot.checkpoint?.state_schema_id === PLAZA_ROOM_SCHEMA_ID
            ? sealed?.open_air
            : null),
      );
      openAirRef.current.cursor = Math.max(
        openAirRef.current.cursor,
        boot.checkpoint?.base_cursor ?? 0,
      );
      processOpenAir(boot.events);
      sealedBaseRef.current = boot.checkpoint?.base_cursor ?? 0;
      const viewer = viewerFromHello(hello);
      allPostsRef.current = roomBootstrapToState(
        createPlaygroundState(),
        viewer,
        boot.checkpoint_payload,
        0,
        null,
      );
      allPostsRef.current.cursor = Math.max(
        allPostsRef.current.cursor,
        boot.checkpoint?.base_cursor ?? 0,
      );
      processAllPosts(boot.events);
      setState((current) => {
        // A World switch drops in-flight live events mapped for the old
        // World; mutes are viewer-local and survive. Reconnects keep both.
        const previous = opts?.fresh
          ? { ...createPlaygroundState(), mutedUserIds: current.mutedUserIds }
          : current;
        const loaded = roomBootstrapToState(
          previous,
          viewer,
          boot.checkpoint_payload,
          0,
          worldIdRef.current,
        );
        return {
          ...loaded,
          cursor: Math.max(loaded.cursor, boot.checkpoint?.base_cursor ?? 0),
        };
      });
      setError(null);
      await catchUpRoomRef.current();
      void fetchCardsRef.current();
    } catch {
      setError("Couldn't load Plaza.");
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
        processOpenAir(page.events);
        processAllPosts(page.events);
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
    const key =
      [...apps].sort().join(",") + "|" + [...activities].sort().join(",");
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
          activities: {
            ...current.cards.activities,
            ...(cards.activities ?? {}),
          },
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
    const displayName =
      viewer?.display_name ?? controllerPresentation?.display_name;
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
    )
      runnerPresentationRef.current = signature;
  }, [controllerPresentation, runnerBacked, state.viewer]);

  // ---- durable lane + presence lane, one socket --------------------------

  // ---- durable lane + presence lane, one socket --------------------------

  useEffect(() => {
    const toParticipant = (
      participant: AppRoomParticipant,
    ): PlaygroundParticipant => ({
      principal_id: participant.principal_id,
      display_name: participant.actor
        ? `${participant.actor.display_name} · AI`
        : participant.display_name,
      actor: participant.actor,
      animal_emoji: participant.animal_emoji,
      is_guest: participant.principal_id.startsWith("guest:"),
      world_id: worldOfParticipant(participant, worldIdRef.current),
      typing: participant.typing,
      transform:
        participant.ephemeral?.kind === PLAZA_EPHEMERAL_TRANSFORM_KIND
          ? {
              ...(participant.ephemeral
                .payload as import("./types").PlaygroundTransform),
              world_id: worldOfParticipant(participant, worldIdRef.current),
            }
          : null,
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
          case "identity":
            window.clearTimeout(identityTimeoutRef.current);
            // What the room now calls you — also after a refused change.
            setState((current) =>
              current.viewer
                ? {
                    ...current,
                    viewer: {
                      ...current.viewer,
                      display_name: message.self.display_name,
                      animal_emoji: message.self.animal_emoji,
                    },
                  }
                : current,
            );
            if (!message.accepted)
              setError("That name couldn't be used. Try another.");
            break;
          case "participant":
            if (runnerAvailableRef.current) break;
            setPresence((current) =>
              applyJoin(
                current,
                toParticipant(message.participant),
                current.online,
                now,
              ),
            );
            break;
          case "hello":
            helloRef.current = message;
            setConnected(true);
            if (!runnerAvailableRef.current)
              setPresence((current) => ({
                ...current,
                self: toParticipant(message.self),
              }));
            setState((current) => ({
              ...current,
              viewer: viewerFromHello(message),
            }));
            setState((current) => setOnline(current, message.online));
            void loadRoom();
            {
              // The room assigns a fresh pseudonym per connection; a name
              // this viewer chose is re-applied each time.
              const chosen = storedIdentity();
              if (
                chosen &&
                !runnerAvailableRef.current &&
                (chosen.display_name !== message.self.display_name ||
                  chosen.animal_emoji !== message.self.animal_emoji)
              ) {
                transportRef.current?.sendIdentity(
                  chosen.display_name,
                  chosen.animal_emoji,
                );
              }
            }
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
              applyJoin(
                current,
                toParticipant(message.participant),
                message.online,
                now,
              ),
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
              applyTyping(
                current,
                message.principal_id,
                message.payload.typing ?? false,
              ),
            );
            break;
          case "ephemeral": {
            if (runnerAvailableRef.current) break;
            const payload = message.ephemeral.payload as Record<
              string,
              unknown
            >;
            if (message.ephemeral.kind === PLAZA_EPHEMERAL_TRANSFORM_KIND) {
              setPresence((current) =>
                applyTransform(current, message.principal_id, payload, now),
              );
            } else if (
              message.ephemeral.kind === PLAZA_EPHEMERAL_FACE_REACTION_KIND &&
              typeof payload.target_principal_id === "string" &&
              typeof payload.emoji === "string" &&
              (PLAYGROUND_FACE_REACTIONS as readonly string[]).includes(
                payload.emoji,
              )
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
              const payload = (
                message.event.op as { post?: Record<string, unknown> }
              ).post;
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
                      ? (runnerActorBySocialPrincipalRef.current.get(
                          principalIdForAuthor(message.event.actor_id),
                        ) ?? principalIdForAuthor(message.event.actor_id))
                      : message.event.actor_id,
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
            void loadRoom({ fresh: true });
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

  useEffect(() => {
    const timer = window.setInterval(() => void maybeSeal(), 30000);
    return () => window.clearInterval(timer);
  }, [maybeSeal]);

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
        onPointerLockChange: (engaged, mode) => {
          setLocked(engaged);
          setLookMode(mode);
        },
        onTargetChange: setTarget,
        onTransform: (transform) => {
          // App-room adapters validate shared interactions against this same live pose.
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
        },
        onRequestChat: () => {
          const npc = conversationNpc(targetRef.current);
          if (npc === "nagi") openGuideRef.current();
          else if (npc) openNeighborRef.current(npc);
          else setChatting(true);
        },
        onRequestMenu: () => openMenuRef.current("profile"),
        onInteract: (item) => {
          // Conversations only use Talk/Enter; this callback opens exhibits.
          if (item.kind !== "app" && item.kind !== "activity") return;
          const card =
            item.kind === "app"
              ? stateRef.current.cards.apps[item.ref]
              : stateRef.current.cards.activities[item.ref];
          if (!card || !card.usable) {
            setError("This isn't available right now.");
            return;
          }
          const path =
            item.kind === "app"
              ? (card as { app_path: string }).app_path
              : `/activity/${encodeURIComponent(item.ref)}`;
          const href = pwaUrl(path);
          if (!href) {
            setError("Couldn't open that link.");
            return;
          }
          // A different origin, so a new tab — same rule the PWA's own App
          // tiles follow.
          window.open(href, "_blank", "noopener");
        },
        onFaceReaction: (principalId, emoji) => {
          const task = guideTaskRef.current;
          if (task?.kind === "practice" && task.skill === "react")
            task.done = true;
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
        onOpenAirAction: (action) => sendOpenAirRef.current(action),
        onError: setError,
      });
    } catch (error) {
      if (import.meta.env.DEV)
        console.error("Plaza initialization failed", error);
      setError("Plaza couldn't start. Reload the page and try again.");
      return;
    }
    worldRef.current = world;
    syncOpenAir();
    world.setSettings(settings);
    setWorldReady(true);
    const unregisterRetention =
      typeof window.atoStartup.registerRetention === "function"
        ? window.atoStartup.registerRetention({
            suspend: () => world.setPaused(true),
            resume: () => world.setPaused(false),
            memoryBytes: () => world.retainedBytes(),
          })
        : () => {};
    return () => {
      unregisterRetention();
      world.dispose();
      worldRef.current = null;
      setWorldReady(false);
    };
  }, []);

  useEffect(() => {
    if (!exploreHint) return;
    const handle = window.setTimeout(() => setExploreHint(false), 8000);
    return () => window.clearTimeout(handle);
  }, [exploreHint]);

  // Push presence into the world. Expiry runs here rather than on a timer:
  // it only matters when something is being drawn.
  useEffect(() => {
    worldRef.current?.setPeerAliases(runnerActorBySocialPrincipalRef.current);
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
    const apps = Object.values(state.cards.apps)
      .filter((card) => card.usable)
      .map((card) => ({
        ref: card.ref,
        kind: "app" as const,
        title: card.title,
        subtitle: card.usable ? "Try it" : "Not available right now",
      }));
    const activities = Object.values(state.cards.activities)
      .filter((card) => card.usable)
      .map((card) => ({
        ref: card.ref,
        kind: "activity" as const,
        title: card.title,
        subtitle:
          card.participant_count !== null
            ? `${card.participant_count} people`
            : "Join",
      }));
    return [...apps, ...activities];
  }, [state.cards]);

  useEffect(() => {
    worldRef.current?.setExhibits(exhibits);
  }, [exhibits]);

  // ---- Nagi ---------------------------------------------------------------

  const isTouch =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(pointer: coarse)").matches ?? false);

  /** What Nagi can see of your situation when she answers. */
  const guideContext = (): GuideContext => ({
    touch: isTouch,
    lookMode,
    engaged: locked,
    canPost: state.viewer?.can_post === true,
    peopleNearby: worldRef.current?.peopleNear(12) ?? 0,
    exhibits: exhibits.length,
    hasTimesOfDay: true,
  });

  const runGuideAction = useCallback((action: GuideAction) => {
    const world = worldRef.current;
    setGuideOpen(false);
    if (!world) return;
    if (action.kind === "practice") {
      const pose = world.viewerPose();
      guideTaskRef.current = {
        kind: "practice",
        skill: action.skill,
        from: pose,
      };
      setGuideNote(PRACTICE_PROMPTS[action.skill]);
      if (action.skill === "talk") return;
      world.requestPointerLock();
      return;
    }
    if (action.kind === "go") {
      setMenuOpen(false);
      const place = PLACE_BY_ID.get(action.place);
      if (!place) return;
      guideTaskRef.current = { kind: "go", place: place.id };
      world.setWaypoint({ x: place.x, z: place.z });
      setGuideNote(`Let's head to ${place.label}. Follow the column of light.`);
      world.requestPointerLock();
      return;
    }
    if (action.kind === "menu") {
      openMenuRef.current(action.section);
    }
  }, []);

  sendOpenAirRef.current = (action) => {
    const transport = transportRef.current;
    if (
      !transport ||
      !connectedRef.current ||
      !stateRef.current.viewer?.can_post
    ) {
      setError(
        "Connect to the plaza to interact with shared objects and neighbors.",
      );
      return;
    }
    const pose = worldRef.current?.viewerPose();
    const started = performance.now();
    beginVisualInput(action.kind);
    const quiet =
      action.kind === "renew" ||
      action.kind === "push" ||
      action.kind === "observe" ||
      action.kind === "react" ||
      (action.kind === "seat" && exploreStatus?.seated === action.id) ||
      (action.kind === "lease" &&
        !!openAirRef.current.leases[action.id] &&
        !action.goal);
    if (
      !quiet &&
      [...pendingActionsRef.current.values()].some((pending) => !pending.quiet)
    )
      return;
    if (!quiet) showInteractionFeedback("Saving action…", true);
    const operationId = crypto.randomUUID();
    pendingActionsRef.current.set(operationId, { action, started, quiet });
    const invocation = transport.prepareMutation(
      {
        t: "openair",
        action,
        ...(pose ? { pose: { ...pose, movement: "idle", pose: "stand" } } : {}),
      },
      operationId,
    );
    void transport
      .invoke(invocation)
      .then(async (result) => {
        await catchUpRoomRef.current();
        if (openAirRef.current.cursor < result.seq) {
          if (!quiet)
            showInteractionFeedback("Waiting for the shared result…", true);
          return;
        }
        // Feedback is produced while processing this exact event, not from a later snapshot.
        if (!quiet && pendingActionsRef.current.has(operationId))
          showInteractionFeedback(
            "Action saved; refreshing the shared result…",
            true,
          );
      })
      .catch((err: unknown) => {
        pendingActionsRef.current.delete(operationId);
        const message = interactionError(err);
        if (!quiet) {
          setError(message);
          showInteractionFeedback(message);
        }
      });
  };
  useEffect(() => {
    const timer = window.setInterval(() => {
      for (const [id, pending] of pendingActionsRef.current)
        if (performance.now() - pending.started > 20000) {
          pendingActionsRef.current.delete(id);
          if (!pending.quiet)
            showInteractionFeedback(
              "The shared result could not be confirmed. Reconnect and check the object before trying again.",
            );
        }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [showInteractionFeedback]);
  useEffect(() => {
    worldRef.current?.setSettings(settings);
    try {
      localStorage.setItem("plaza.explore-settings", JSON.stringify(settings));
    } catch {
      /* Viewer preference only. */
    }
  }, [settings, worldReady]);
  useEffect(() => {
    syncOpenAir();
    const timer = window.setInterval(
      () => setExploreStatus(worldRef.current?.exploreStatus() ?? null),
      500,
    );
    const renewal = window.setInterval(() => {
      const own = stateRef.current.viewer?.principal_id;
      const seat = worldRef.current?.exploreStatus().seated,
        pose = worldRef.current?.viewerPose();
      if (seat && pose)
        sendOpenAirRef.current({
          kind: "seat",
          id: seat,
          x: pose.x,
          z: pose.z,
        });
      const held = own
        ? heldItem(openAirRef.current, own, Date.now() + clockOffsetRef.current)
        : null;
      if (held && pose)
        sendOpenAirRef.current({
          kind: "renew",
          id: held,
          x: pose.x,
          z: pose.z,
        });
      for (const [id, lease] of Object.entries(openAirRef.current.leases))
        if (lease?.owner === own && lease.goal) {
          const p = worldRef.current?.residentPosition(id);
          if (p && pose && Math.hypot(p.x - pose.x, p.z - pose.z) < 4)
            worldRef.current?.holdNeighbor(id, true);
        }
    }, 10000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(renewal);
    };
  }, [connected, worldReady, syncOpenAir]);

  // A resident you are talking to stays put and faces you until you are done.
  useEffect(() => {
    if (!guideOpen) return;
    const world = worldRef.current;
    escortIntentRef.current = null;
    world?.holdNeighbor(talkingTo, true);
    const ownership = window.setInterval(() => {
      const lease = activeLease(
        openAirRef.current,
        talkingTo as ResidentId,
        Date.now() + clockOffsetRef.current,
      );
      if (lease && lease.owner !== stateRef.current.viewer?.principal_id) {
        setGuideOpen(false);
        setError(
          "This neighbor is helping someone else. Please try another neighbor.",
        );
      }
    }, 500);
    const timer = window.setInterval(
      () => world?.holdNeighbor(talkingTo, true),
      10000,
    );
    return () => {
      window.clearInterval(timer);
      window.clearInterval(ownership);
      const lease = activeLease(
        openAirRef.current,
        talkingTo as ResidentId,
        Date.now() + clockOffsetRef.current,
      );
      if (!lease?.goal && escortIntentRef.current !== talkingTo)
        world?.holdNeighbor(talkingTo, false);
    };
  }, [guideOpen, talkingTo]);

  // Watch the lesson or journey in progress, a few times a second.
  useEffect(() => {
    const finish = (line: string) => {
      guideTaskRef.current = null;
      setGuideNote(line);
      worldRef.current?.guideSay(SUCCESS_LINE);
      window.setTimeout(
        () => setGuideNote((current) => (current === line ? null : current)),
        6000,
      );
    };
    const timer = window.setInterval(() => {
      const task = guideTaskRef.current;
      const world = worldRef.current;
      if (!task || !world) return;
      const pose = world.viewerPose();
      if (task.kind === "go") {
        const place = PLACE_BY_ID.get(task.place as never);
        if (!place) return;
        const distance = Math.hypot(pose.x - place.x, pose.z - place.z);
        if (distance <= place.radius) {
          world.setWaypoint(null);
          finish(`We're here. ${SUCCESS_LINE}`);
        } else {
          setGuideNote(`${Math.round(distance)} m to ${place.label}`);
        }
        return;
      }
      const from = task.from;
      const turned = Math.abs(
        Math.atan2(
          Math.sin(pose.yaw - from.yaw),
          Math.cos(pose.yaw - from.yaw),
        ),
      );
      const done =
        task.done ||
        (task.skill === "move" &&
          Math.hypot(pose.x - from.x, pose.z - from.z) > 2.5) ||
        (task.skill === "look" && turned > 1.2) ||
        (task.skill === "jump" && pose.y > from.y + 0.35);
      if (done) finish(SUCCESS_LINE);
    }, 150);
    return () => window.clearInterval(timer);
  }, []);

  // Opening the composer is the "talk" lesson's goal.
  useEffect(() => {
    const task = guideTaskRef.current;
    if (chatting && task?.kind === "practice" && task.skill === "talk")
      task.done = true;
  }, [chatting]);

  // Chat and pointer lock are mutually exclusive: a locked pointer swallows
  // the keystrokes the composer needs.
  useEffect(() => {
    if (menuOpen || guideOpen) {
      worldRef.current?.setPaused(true);
      document.exitPointerLock?.();
    }
  }, [menuOpen, guideOpen]);

  useEffect(() => {
    worldRef.current?.setPaused(chatting || menuOpen || guideOpen);
    if (chatting) {
      document.exitPointerLock?.();
      const handle = window.setTimeout(() => inputRef.current?.focus(), 30);
      return () => window.clearTimeout(handle);
    }
  }, [chatting, menuOpen, guideOpen]);

  useEffect(() => {
    worldRef.current?.setTimeOfDay(timeOfDay);
    try {
      if (timeOfDay) window.localStorage.setItem(TIME_OF_DAY_KEY, timeOfDay);
      else window.localStorage.removeItem(TIME_OF_DAY_KEY);
    } catch {
      // Remembering the choice is a convenience; the switch still works.
    }
  }, [timeOfDay, worldReady]);

  const viewer = state.viewer;
  const canPost = viewer?.can_post === true;
  const remaining = TEXT_LIMIT - [...draft].length;

  const saveIdentity = useCallback(
    (displayName: string, animalEmoji: string) => {
      try {
        window.localStorage.setItem(
          IDENTITY_KEY,
          JSON.stringify({
            display_name: displayName,
            animal_emoji: animalEmoji,
          }),
        );
      } catch {
        // Remembering is a convenience; the change still applies to this visit.
      }
      transportRef.current?.sendIdentity(displayName, animalEmoji);
      // A room that predates name changes never answers; say so rather than
      // leaving Save looking like it worked.
      window.clearTimeout(identityTimeoutRef.current);
      identityTimeoutRef.current = window.setTimeout(() => {
        setError("Name changes aren't available in this room yet.");
      }, 4000);
    },
    [],
  );

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
        setError("Couldn't send your message.");
      }
      closeChat();
    },
    [draft, canPost, remaining, catchUpRoom, closeChat, maybeSeal],
  );

  const online = runnerAvailableRef.current
    ? presence.online
    : state.online || presence.online;

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
        <button
          type="button"
          className="pg-menu-open"
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          onClick={(event) => {
            event.currentTarget.blur();
            openMenu("profile");
          }}
        >
          <span aria-hidden="true">☰</span> Menu <kbd>M</kbd>
        </button>
      </header>

      <PlazaMenu
        open={menuOpen}
        focus={menuFocus}
        onClose={() => setMenuOpen(false)}
        identity={
          viewer
            ? {
                displayName: viewer.display_name,
                animalEmoji: viewer.animal_emoji,
              }
            : null
        }
        canEditIdentity={connected && !runnerAvailableRef.current && !!viewer}
        connected={connected}
        onSaveIdentity={saveIdentity}
        worlds={WORLDS}
        worldId={worldId}
        worldOnline={presence.worldOnline}
        online={online}
        onEnterWorld={(id) => {
          setMenuOpen(false);
          worldRef.current?.enterWorld(id);
        }}
        timeOfDay={timeOfDay}
        onTimeOfDay={setTimeOfDay}
        lookMode={lookMode}
        settings={settings}
        onSettings={setSettings}
        onPlace={(id) =>
          runGuideAction({
            kind: "go",
            place: id as import("./guide/nagi").PlaceId,
          })
        }
      />

      {!runnerBacked && !runnerAvailableRef.current && connected ? (
        <CoopControls
          posts={state.order.map((id) => state.posts.get(id)!).filter(Boolean)}
          participants={[...presence.members.values()]}
          onFocusChange={(paused) => worldRef.current?.setPaused(paused)}
        />
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
              ? `from ${presence.selfReaction.from_animal_emoji} ${presence.selfReaction.from_display_name}`
              : "for you"}
          </span>
        </div>
      ) : null}

      {target &&
      !isConversationTarget(target) &&
      !chatting &&
      !guideOpen &&
      !menuOpen ? (
        <div className="pg-interaction">
          {target.kind !== "object" && <strong>{targetTitle(target)}</strong>}
          <button
            type="button"
            onClick={() => worldRef.current?.interactWithTarget()}
            disabled={exploreStatus?.pending}
          >
            {target.kind === "object"
              ? target.title
              : targetActionLabel(target)}
            <kbd>{settings.keys.interact.replace("Key", "")}</kbd>
          </button>
        </div>
      ) : null}

      {!locked && !chatting && !menuOpen && !guideOpen ? (
        <button
          type="button"
          className="pg-enter"
          disabled={!worldReady}
          onClick={() => {
            if (!exploreHintSeen) {
              setExploreHint(true);
              setExploreHintSeen(true);
            }
            worldRef.current?.requestPointerLock();
          }}
        >
          {worldReady ? "Click to explore" : "Getting the plaza ready…"}
        </button>
      ) : null}

      <ExploreControls
        status={exploreStatus}
        hidden={menuOpen || guideOpen || chatting}
        onUse={(throwing) => worldRef.current?.useHeld(throwing)}
        onCharge={(on) => worldRef.current?.charge(on)}
        onCancelCharge={() => worldRef.current?.cancelCharge()}
        onRotate={() => worldRef.current?.rotateHeld()}
        onMark={() => worldRef.current?.mark()}
        onStopEscort={() => worldRef.current?.stopEscort()}
      />

      {exploreHint ? (
        <div className="pg-explore-hint" role="status">
          <span>
            WASD to move ·{" "}
            {lookMode === "drag" ? "Drag to look" : "Mouse to look"} · Space to
            jump ·{" "}
            {lookMode === "drag"
              ? "Esc to leave explore mode"
              : "Esc to release the mouse"}
          </span>
          <button
            type="button"
            aria-label="Dismiss movement instructions"
            onClick={() => setExploreHint(false)}
          >
            ✕
          </button>
        </div>
      ) : null}

      <GuideDialog
        open={guideOpen}
        currentPlace={exploreStatus?.place}
        npc={npcProfile(talkingTo)}
        context={guideContext()}
        start={guideStart ?? guideReply("greeting", guideContext())}
        onAction={runGuideAction}
        onClose={() => setGuideOpen(false)}
        // The server decides who gets the model (an ato session, even in a
        // shared Public instance where the room calls everyone a guest).
        useModel={
          connected &&
          activeLease(
            openAirRef.current,
            talkingTo as ResidentId,
            Date.now() + clockOffsetRef.current,
          )?.owner === state.viewer?.principal_id
        }
        waitingForClaim={
          connected &&
          !!state.viewer?.can_post &&
          !activeLease(
            openAirRef.current,
            talkingTo as ResidentId,
            Date.now() + clockOffsetRef.current,
          )
        }
        onEscort={(goal) => {
          const lease = activeLease(
            openAirRef.current,
            talkingTo as ResidentId,
            Date.now() + clockOffsetRef.current,
          );
          if (!lease || lease.owner !== stateRef.current.viewer?.principal_id)
            return;
          escortIntentRef.current = talkingTo;
          worldRef.current?.escort(talkingTo as ResidentId, goal);
          setGuideOpen(false);
        }}
        sharedApps={Object.values(state.cards.apps)
          .filter((card) => card.usable)
          .map((card) => ({ ref: card.ref, title: card.title }))}
        onTryApp={(ref) => {
          const card = stateRef.current.cards.apps[ref];
          const href = card?.usable && pwaUrl(card.app_path);
          if (href) window.open(href, "_blank", "noopener");
        }}
        onDiscussApp={(ref) => {
          const card = stateRef.current.cards.apps[ref];
          const href = card?.usable && pwaUrl(card.app_path);
          if (!href) return;
          setGuideOpen(false);
          setDraft(`${card.title}: ${href}`.slice(0, 200));
          setChatting(true);
        }}
        heldItem={exploreStatus?.held}
        onDeliver={() => worldRef.current?.deliver()}
        memories={exploreStatus?.memories ?? []}
      />

      {guideNote && !guideOpen ? (
        <div className="pg-guide-note" role="status">
          <span aria-hidden="true">👒</span>
          <span>
            <strong>{npcProfile(talkingTo).name}</strong>
            {guideNote}
          </span>
          <button
            type="button"
            aria-label="Close"
            onClick={() => {
              setGuideNote(null);
              if (guideTaskRef.current?.kind === "go")
                worldRef.current?.setWaypoint(null);
              guideTaskRef.current = null;
            }}
          >
            ✕
          </button>
        </div>
      ) : null}

      <footer className="pg-bottom">
        {/* Who you are lives in the Menu; the HUD only speaks up when the
            connection is not there. */}
        {connected ? null : (
          <div className="pg-connection" role="status">
            {viewer ? "Reconnecting…" : "Connecting…"}
          </div>
        )}
        {/* Everything you say to people, in one place: reactions to whoever
            you face, and the message composer. */}
        <div className="pg-talk">
          <button
            type="button"
            className="pg-reactions-toggle"
            aria-label="Reactions"
            aria-expanded={reactionsOpen}
            onClick={() => setReactionsOpen((value) => !value)}
          >
            ☺
          </button>
          <div
            className={`pg-reactions${reactionsOpen ? " pg-reactions--open" : ""}`}
            role="group"
            aria-label="Reactions"
          >
            {PLAYGROUND_FACE_REACTIONS.map((emoji, index) => (
              <button
                key={emoji}
                type="button"
                title={`${index + 1} · React to whoever you're facing`}
                disabled={
                  !canPost &&
                  target?.kind !== "mascot" &&
                  target?.kind !== "guide"
                }
                aria-label={`React ${emoji}`}
                onClick={() => {
                  worldRef.current?.reactAtTarget(emoji);
                  setReactionsOpen(false);
                }}
              >
                <span aria-hidden="true">{emoji}</span>
                <kbd>{index + 1}</kbd>
              </button>
            ))}
          </div>
          {canPost || target?.kind === "mascot" || target?.kind === "guide" ? (
            <button
              type="button"
              className="pg-chat-open"
              onClick={() => {
                setReactionsOpen(false);
                const npc = conversationNpc(target);
                if (npc === "nagi") openGuide();
                else if (npc) openNeighbor(npc);
                else setChatting(true);
              }}
            >
              {isConversationTarget(target) && target && "name" in target
                ? `Talk to ${target.name}`
                : "Talk nearby"}
              <kbd>↵</kbd>
            </button>
          ) : (
            <a
              className="pg-chat-open"
              href={pwaUrl(SIGN_IN_PATH) ?? SIGN_IN_PATH}
            >
              Sign in to talk
            </a>
          )}
        </div>
      </footer>

      <MobileJoystick
        onChange={(x, y) => worldRef.current?.setJoystick(x, y)}
      />

      {/* Act on touch-DOWN, not click: a phone does not synthesize a click
          for a second finger while the first is on the joystick. */}
      <div className="pg-actions">
        <PressButton
          className={`pg-action${crouched ? " pg-action--active" : ""}`}
          aria-pressed={crouched}
          aria-label="Crouch"
          onPress={toggleCrouch}
        >
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <circle cx="12" cy="7" r="2" />
            <path d="m11 10-3 4 5 2-3 5m1-11 4 3 4-1m-6 4 5 1 2 4M3 3v6m-2-2 2 2 2-2" />
          </svg>
        </PressButton>
        <PressButton
          className="pg-action"
          aria-label="Jump"
          onPress={() => worldRef.current?.jump(true)}
          onRelease={() => worldRef.current?.jump(false)}
        >
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <circle cx="13" cy="5" r="2" />
            <path d="m12 8-2 5 4 3 1 5m-5-8-4 4-3-1m9-8-4 1-2-3m6 2 4 3 4-3M3 9V3m-2 2 2-2 2 2" />
          </svg>
        </PressButton>
      </div>

      {chatting ? (
        <form className="pg-compose" onSubmit={submit}>
          <input
            ref={inputRef}
            aria-label="Message"
            placeholder={
              target?.kind === "person"
                ? `Talk near ${target.name}…`
                : "Talk to everyone nearby…"
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
          <span
            className={`pg-remaining${remaining < 0 ? " pg-remaining--over" : ""}`}
          >
            {remaining}
          </span>
          <button
            type="submit"
            disabled={!canPost || !draft.trim() || remaining < 0}
          >
            Send
          </button>
          <button type="button" onClick={closeChat} aria-label="Close">
            ✕
          </button>
        </form>
      ) : null}

      <output hidden id="pg-input-measurements">
        {JSON.stringify(interactionMeasurements())}
      </output>
      {error ? (
        <div className="pg-notice" role="status">
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Close"
          >
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
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Touch Events, tracked by touch identifier — not Pointer Events. When a
  // second finger lands (say on Jump) a phone may decide a gesture has begun
  // and pointercancel the stick finger, which used to zero the stick and stop
  // the walk mid-jump. Touch events keep arriving for that finger until it
  // actually lifts.
  useEffect(() => {
    const base = baseRef.current;
    if (!base) return;
    let touchId: number | null = null;
    const radius = 34;
    const place = (touch: Touch) => {
      const rect = base.getBoundingClientRect();
      let x = touch.clientX - rect.left - rect.width / 2;
      let y = touch.clientY - rect.top - rect.height / 2;
      const length = Math.hypot(x, y);
      if (length > radius) {
        x *= radius / length;
        y *= radius / length;
      }
      if (stickRef.current)
        stickRef.current.style.transform = `translate(${x}px, ${y}px)`;
      onChangeRef.current(x / radius, -y / radius);
    };
    const find = (list: TouchList) => {
      for (let index = 0; index < list.length; index += 1) {
        if (list[index].identifier === touchId) return list[index];
      }
      return null;
    };
    const start = (event: TouchEvent) => {
      event.preventDefault();
      if (touchId !== null) return;
      const touch = event.changedTouches[0];
      touchId = touch.identifier;
      place(touch);
    };
    const move = (event: TouchEvent) => {
      const touch = touchId === null ? null : find(event.changedTouches);
      if (touch) place(touch);
    };
    const end = (event: TouchEvent) => {
      if (touchId === null || !find(event.changedTouches)) return;
      touchId = null;
      if (stickRef.current) stickRef.current.style.transform = "";
      onChangeRef.current(0, 0);
    };
    base.addEventListener("touchstart", start, { passive: false });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", end);
    window.addEventListener("touchcancel", end);
    return () => {
      base.removeEventListener("touchstart", start);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
    };
  }, []);

  return (
    <div className="pg-joystick" ref={baseRef} aria-hidden="true">
      <div ref={stickRef} />
    </div>
  );
}

/**
 * A button that acts the moment it is touched — on touchstart, so it works as
 * a second finger while the first walks — and still on a mouse press or a
 * keyboard activation.
 */
function PressButton({
  onPress,
  onRelease,
  children,
  ...rest
}: Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick" | "onPointerDown"
> & {
  onPress: () => void;
  onRelease?: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const onReleaseRef = useRef(onRelease);
  onReleaseRef.current = onRelease;
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;
  useEffect(() => {
    const button = ref.current;
    if (!button) return;
    const start = (event: TouchEvent) => {
      event.preventDefault();
      onPressRef.current();
    };
    const end = () => onReleaseRef.current?.();
    button.addEventListener("touchstart", start, { passive: false });
    button.addEventListener("touchend", end);
    button.addEventListener("touchcancel", end);
    return () => {
      button.removeEventListener("touchstart", start);
      button.removeEventListener("touchend", end);
      button.removeEventListener("touchcancel", end);
    };
  }, []);
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      onPointerDown={(event) => {
        if (event.pointerType === "touch") return; // handled by touchstart
        event.preventDefault();
        onPressRef.current();
      }}
      onPointerUp={() => onReleaseRef.current?.()}
      onPointerCancel={() => onReleaseRef.current?.()}
      onClick={(event) => {
        if (event.detail === 0) onPressRef.current(); // keyboard
      }}
    >
      {children}
    </button>
  );
}
