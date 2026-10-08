/**
 * What Plaza's guides know and may offer — the single source both the page
 * and the API read.
 *
 * Bundled into ato-api (scripts/build-coop-adapter.mjs → plaza-guide.generated.js)
 * so the conversation API composes the model's instructions from exactly the
 * facts, persona and choice catalogue this Plaza build implements. The model
 * never names an action directly: it may only return choice IDs from
 * CHOICE_IDS, which both sides map to the same GuideAction.
 */
import type { GuideAction, GuideChoice, GuideContext, GuideReply, PlaceId, PracticeSkill } from "./nagi";
import { departure, PLACE_BY_ID, PLACES, reply, understand } from "./nagi";
import {
  LINES,
  PERSONALITY_STYLE,
  RESIDENT_BY_ID,
  RESIDENT_PROFILES,
  type ResidentId,
} from "./residents";

export const GUIDE_KNOWLEDGE_VERSION = "plaza.guide@2";

/** Everyone in Plaza you can talk to: the guide and the ten residents. */
export type NpcId = "nagi" | ResidentId;
export const NPC_IDS: readonly NpcId[] = ["nagi", ...RESIDENT_PROFILES.map((resident) => resident.id)];

export function isNpcId(value: unknown): value is NpcId {
  return typeof value === "string" && (NPC_IDS as readonly string[]).includes(value);
}

/** Every choice a guide may offer, by stable ID. */
export const CHOICE_CATALOG: Readonly<Record<string, GuideChoice>> = (() => {
  const out: Record<string, GuideChoice> = {};
  const node = (id: string, label: string, action: GuideAction) => {
    out[id] = { label, action };
  };
  node("node:about", "What is Plaza?", { kind: "node", node: "about" });
  node("node:whatCan", "What can I do?", { kind: "node", node: "whatCan" });
  node("node:controls", "The controls", { kind: "node", node: "controls" });
  node("node:move", "Moving", { kind: "node", node: "move" });
  node("node:look", "Looking around", { kind: "node", node: "look" });
  node("node:jump", "Jumping", { kind: "node", node: "jump" });
  node("node:talk", "Talking", { kind: "node", node: "talk" });
  node("node:react", "Reactions", { kind: "node", node: "react" });
  node("node:timeAndWorld", "Time of day and worlds", { kind: "node", node: "timeAndWorld" });
  node("node:profile", "Name and icon", { kind: "node", node: "profile" });
  node("node:places", "Show me around", { kind: "node", node: "places" });
  const practice: [PracticeSkill, string][] = [
    ["move", "Let me try walking"],
    ["look", "Let me try looking around"],
    ["jump", "Let me try jumping"],
    ["talk", "Let me try talking"],
    ["react", "Let me try a reaction"],
  ];
  for (const [skill, label] of practice) node(`practice:${skill}`, label, { kind: "practice", skill });
  for (const place of PLACES) {
    node(`place:${place.id}`, `Go to ${place.label}`, { kind: "place", place: place.id as PlaceId });
  }
  // A resident points the way and lets you set off; only Nagi describes it first.
  for (const place of PLACES) {
    node(`go:${place.id}`, `Head to ${place.label}`, { kind: "go", place: place.id as PlaceId });
  }
  node("menu:profile", "Open the Menu (name and icon)", { kind: "menu", section: "profile" });
  node("menu:world", "Open the Menu (time and worlds)", { kind: "menu", section: "world" });
  node("menu:controls", "Open the Menu (controls)", { kind: "menu", section: "controls" });
  return out;
})();

export const CHOICE_IDS: readonly string[] = Object.keys(CHOICE_CATALOG);

/** The choices each kind of character may offer: Nagi teaches, residents point the way. */
export function choiceIdsFor(npcId: NpcId): readonly string[] {
  return npcId === "nagi"
    ? CHOICE_IDS.filter((id) => !id.startsWith("go:"))
    : CHOICE_IDS.filter((id) => id.startsWith("go:") || id.startsWith("menu:"));
}

/**
 * IDs → choices the visitor can actually use right now. Unknown IDs, and
 * choices the situation rules out (reacting with nobody near, an exhibit
 * that is not there, talking while signed out), are dropped.
 */
export function choicesFromIds(
  ids: readonly unknown[],
  context: GuideContext,
  npcId: NpcId = "nagi",
  max = 3,
): GuideChoice[] {
  const allowed = new Set(choiceIdsFor(npcId));
  const out: GuideChoice[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id !== "string" || seen.has(id) || !allowed.has(id)) continue;
    if (id === "practice:react" && context.peopleNearby === 0) continue;
    if (id === "practice:talk" && !context.canPost) continue;
    if ((id === "place:exhibits" || id === "go:exhibits") && context.exhibits === 0) continue;
    if (id === "menu:world" && !context.hasTimesOfDay) continue;
    seen.add(id);
    out.push(CHOICE_CATALOG[id]);
    if (out.length >= max) break;
  }
  return out;
}

export interface NpcProfile {
  id: NpcId;
  name: string;
  /** Shown under the name in the conversation. */
  role: "Guide" | "Neighbor";
  /** A small mark for the conversation header. */
  avatar: string;
  persona: string;
}

const NAGI_PERSONA = [
  "You are Nagi, the guide of Plaza.",
  "You are kind, calm and easy to understand for first-time visitors.",
  "You speak politely and warmly, and you keep every reply short: one to three sentences, one point at a time.",
  "You greet lightly and otherwise help when asked; you do not lecture.",
  "Your role: introduce Plaza, explain the controls, guide people to places, and help sort out what is going wrong.",
  "Reply in the language the visitor writes in (English if unsure).",
].join(" ");

const SPECIES_MARK: Record<string, string> = {
  cat: "🐱", dog: "🐶", panda: "🐼", fox: "🦊", penguin: "🐧",
  rabbit: "🐰", bear: "🐻", koala: "🐨", frog: "🐸", owl: "🦉",
};

function residentPersona(id: ResidentId): string {
  const me = RESIDENT_BY_ID.get(id)!;
  const neighbours = RESIDENT_PROFILES.filter((other) => other.id !== id)
    .map((other) => `${other.name} the ${other.species}`)
    .join(", ");
  return [
    `You are ${me.name}, a ${me.species} who lives in Plaza, a shared 3D beach plaza.`,
    `Your personality: ${PERSONALITY_STYLE[me.personality]}.`,
    "You are a neighbor, not the guide: chat in character about your day, the beach, the fountain, the weather and the other residents.",
    `Your neighbors are ${neighbours}, and Nagi, the guide who stands near the fountain.`,
    "Keep every reply to one or two short sentences.",
    "If the visitor asks how to do something in Plaza, answer briefly using only the facts below, or suggest they ask Nagi.",
    "You cannot follow the visitor, give them items, or remember them after this conversation; never pretend you can.",
    "Reply in the language the visitor writes in (English if unsure).",
  ].join(" ");
}

export function npcProfile(id: NpcId): NpcProfile {
  if (id === "nagi") return { id, name: "Nagi", role: "Guide", avatar: "👒", persona: NAGI_PERSONA };
  const resident = RESIDENT_BY_ID.get(id)!;
  return {
    id,
    name: resident.name,
    role: "Neighbor",
    avatar: SPECIES_MARK[resident.species] ?? "🙂",
    persona: residentPersona(id),
  };
}

/** What is true in this Plaza build, phrased for the visitor's situation. */
export function plazaFacts(context: GuideContext & { signedIn: boolean }): string {
  const move = context.touch
    ? "Walk with the stick at the bottom left; drag the right side of the screen to look around; Jump and Crouch are buttons on the right."
    : context.lookMode === "drag"
      ? "Walk with W, A, S, D; drag across the view to look around; Space jumps; C or Ctrl crouches."
      : "Click the view to start, then walk with W, A, S, D and look with the mouse; Space jumps; C or Ctrl crouches; Esc releases the mouse.";
  const facts = [
    "Plaza is one shared 3D beach plaza where people meet, walk around, talk to people nearby, and try apps that people have shared on display boards.",
    move,
    "You can jump onto the fountain's rim, walk down the beach and wade into the shallows.",
    context.signedIn
      ? "Talk at the bottom right (Enter on a keyboard) opens a message box; messages are seen by everyone in the plaza."
      : "Talking and posting need signing in, via 'Sign in to talk' at the bottom right.",
    "Reactions (four emoji at the bottom right, or keys 1 to 4) go to the person you are facing.",
    "To change your name or icon: open the Menu, edit the name or pick an icon under your profile, then press Save.",
    "The Menu (top left, or the M key) has: your name and icon, the time of day (Day or Sunset, which only changes your own view), the list of worlds (only Central Plaza is open; the others are coming soon), and a list of controls.",
    "Ten animal residents live in the plaza and wander about; you can talk to them with E (or the Talk prompt) when you face one.",
    `Places a guide can lead you to: ${PLACES.filter((place) => place.id !== "exhibits" || context.exhibits > 0)
      .map((place) => `${place.label} (${place.description})`)
      .join("; ")}.`,
    context.peopleNearby > 0
      ? `There are ${context.peopleNearby} people near the visitor right now.`
      : "Nobody else is near the visitor right now.",
    "Things Plaza does NOT have: swimming or diving, building or editing the world, inventories or items, trading, voice chat, private messages, mini-games. Never claim these exist.",
  ];
  return facts.join("\n");
}

/** The response contract the model must follow; the API validates it. */
export function responseContract(npcId: NpcId): string {
  const ids = choiceIdsFor(npcId);
  return [
    "Respond with ONLY a JSON object, no other text:",
    '{"text": "<your reply>", "choices": ["<choice id>", ...]}',
    npcId === "nagi"
      ? "choices: up to 3 IDs from this list that would be useful next steps, most useful first:"
      : "choices: usually []. Only when the visitor wants to go somewhere or change a setting, up to 2 IDs from this list:",
    ids.join(", "),
    npcId === "nagi"
      ? "Never invent choice IDs, coordinates, commands or features. If you are unsure what the visitor wants, ask one short clarifying question and offer node:controls and node:places."
      : "Never invent choice IDs, coordinates, commands or features.",
  ].join("\n");
}

/** What a character suggests when the model offered nothing usable. */
export function defaultChoiceIds(npcId: NpcId): readonly string[] {
  return npcId === "nagi" ? DEFAULT_CHOICE_IDS : [];
}

export const DEFAULT_CHOICE_IDS = ["node:whatCan", "node:places", "node:about"];

/** The instructions for a character, composed only from this build's facts. */
export function npcInstructions(npcId: NpcId, context: GuideContext & { signedIn: boolean }): string {
  return [
    npcProfile(npcId).persona,
    "",
    `Facts about Plaza (${GUIDE_KNOWLEDGE_VERSION}). Only state things listed here; if asked about anything else, say you are not sure and suggest what Plaza does have:`,
    plazaFacts(context),
  ].join("\n");
}

/** How a resident opens a conversation. */
export function residentGreeting(id: ResidentId, seed: number): GuideReply {
  const greet = LINES[RESIDENT_BY_ID.get(id)!.personality].greet;
  return { text: greet[Math.abs(Math.floor(seed)) % greet.length], choices: [] };
}

function textSeed(text: string): number {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) | 0;
  return Math.abs(hash);
}

/**
 * The rule-based answer, without a model: Nagi's own guide, or a resident's
 * small talk — pointing to Nagi when the visitor seems to want help.
 */
export function npcFallback(npcId: NpcId, message: string, context: GuideContext): GuideReply {
  const intent = understand(message);
  if (npcId === "nagi") {
    if ("place" in intent) {
      const place = PLACE_BY_ID.get(intent.place);
      if (place) return departure(place);
    }
    return reply("node" in intent ? intent.node : "unclear", context);
  }
  const resident = RESIDENT_BY_ID.get(npcId)!;
  const talk = LINES[resident.personality].talk;
  const line = talk[textSeed(message) % talk.length];
  if ("place" in intent) {
    return { text: line, choices: choicesFromIds([`go:${intent.place}`], context, npcId) };
  }
  if ("node" in intent && intent.node !== "unclear") {
    return { text: `${line} If you need help, Nagi by the fountain knows everything.`, choices: [] };
  }
  return { text: line, choices: [] };
}
