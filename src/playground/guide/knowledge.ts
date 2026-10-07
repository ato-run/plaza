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
import type { GuideAction, GuideChoice, GuideContext, PlaceId, PracticeSkill } from "./nagi";
import { PLACES } from "./nagi";

export const GUIDE_KNOWLEDGE_VERSION = "plaza.guide@1";

export type NpcId = "nagi";
export const NPC_IDS: readonly NpcId[] = ["nagi"];

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
  node("menu:profile", "Open the Menu (name and icon)", { kind: "menu", section: "profile" });
  node("menu:world", "Open the Menu (time and worlds)", { kind: "menu", section: "world" });
  node("menu:controls", "Open the Menu (controls)", { kind: "menu", section: "controls" });
  return out;
})();

export const CHOICE_IDS: readonly string[] = Object.keys(CHOICE_CATALOG);

/**
 * IDs → choices the visitor can actually use right now. Unknown IDs, and
 * choices the situation rules out (reacting with nobody near, an exhibit
 * that is not there, talking while signed out), are dropped.
 */
export function choicesFromIds(ids: readonly unknown[], context: GuideContext, max = 3): GuideChoice[] {
  const out: GuideChoice[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id !== "string" || seen.has(id) || !Object.hasOwn(CHOICE_CATALOG, id)) continue;
    if (id === "practice:react" && context.peopleNearby === 0) continue;
    if (id === "practice:talk" && !context.canPost) continue;
    if (id === "place:exhibits" && context.exhibits === 0) continue;
    if (id === "menu:world" && !context.hasTimesOfDay) continue;
    seen.add(id);
    out.push(CHOICE_CATALOG[id]);
    if (out.length >= max) break;
  }
  return out;
}

export const PERSONAS: Readonly<Record<NpcId, { name: string; persona: string }>> = {
  nagi: {
    name: "Nagi",
    persona: [
      "You are Nagi, the guide of Plaza.",
      "You are kind, calm and easy to understand for first-time visitors.",
      "You speak politely and warmly, and you keep every reply short: one to three sentences, one point at a time.",
      "You greet lightly and otherwise help when asked; you do not lecture.",
      "Your role: introduce Plaza, explain the controls, guide people to places, and help sort out what is going wrong.",
      "Reply in the language the visitor writes in (English if unsure).",
    ].join(" "),
  },
};

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
export const RESPONSE_CONTRACT = [
  "Respond with ONLY a JSON object, no other text:",
  '{"text": "<your reply, 1-3 sentences>", "choices": ["<choice id>", ...]}',
  "choices: up to 3 IDs from this list that would be useful next steps, most useful first:",
  CHOICE_IDS.join(", "),
  "Never invent choice IDs, coordinates, commands or features. If you are unsure what the visitor wants, ask one short clarifying question and offer node:controls and node:places.",
].join("\n");

export const DEFAULT_CHOICE_IDS = ["node:whatCan", "node:places", "node:about"];
