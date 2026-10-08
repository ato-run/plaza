import { OPEN_AIR_PLACES } from "../world/openAir/layout";
/**
 * Nagi — Plaza's guide. What she says, and what each answer lets you do next.
 *
 * Pure and local: no network, no model. Every reply is chosen from what is
 * actually implemented and from the visitor's situation right now (touch or
 * keyboard, locked or drag look, signed in or not, anyone nearby, anything on
 * display), and every reply ends in choices — something to try, somewhere to
 * go, or another question — so talking to her is a way into using Plaza, not
 * a page of text.
 */

/** What the guide can see of the visitor's situation. */
export interface GuideContext {
  touch: boolean;
  /** How the view is steered on a non-touch device. */
  lookMode: "lock" | "drag";
  /** Whether the view is engaged (keys reach the world). */
  engaged: boolean;
  canPost: boolean;
  peopleNearby: number;
  exhibits: number;
  hasTimesOfDay: boolean;
}

/** Things the page can do when a choice is picked. */
export type GuideAction =
  | { kind: "node"; node: GuideNodeId }
  | { kind: "practice"; skill: PracticeSkill }
  /** Pick a place: she describes it and offers "Let's go". */
  | { kind: "place"; place: PlaceId }
  /** Set off: the page shows the way there. */
  | { kind: "go"; place: PlaceId }
  | { kind: "menu"; section: "profile" | "world" | "controls" }
  | { kind: "close" };

export interface GuideChoice {
  label: string;
  action: GuideAction;
}

export interface GuideReply {
  text: string;
  choices: GuideChoice[];
}

export type PracticeSkill = "move" | "look" | "jump" | "talk" | "react";
export type PlaceId =
  | "fountain"
  | "exhibits"
  | "shore"
  | "entrance"
  | "lookout"
  | "pools"
  | "pier"
  | "camp";

export type GuideNodeId =
  | "greeting"
  | "about"
  | "whatCan"
  | "controls"
  | "move"
  | "look"
  | "jump"
  | "talk"
  | "react"
  | "timeAndWorld"
  | "profile"
  | "places"
  | "unclear"
  | "thanks";

export interface Place {
  id: PlaceId;
  label: string;
  x: number;
  z: number;
  /** Arrived when this close, metres. */
  radius: number;
  description: string;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Where she can take you. Coordinates are the plaza's (see centralGeometry). */
export const PLACES: readonly Place[] = [
  ...OPEN_AIR_PLACES.map((p) => ({
    id: p.id,
    label: p.name,
    x: p.x,
    z: p.z,
    radius: p.radius,
    description: p.description,
  })),
  {
    id: "fountain",
    label: "the fountain",
    x: 0,
    z: 0,
    radius: 4.6,
    description:
      "It's in the middle of the plaza, and you can jump up onto its rim",
  },
  {
    id: "exhibits",
    label: "the app exhibits",
    x: 0,
    z: -12,
    radius: 3.2,
    description: "That's where the apps people have shared are on display",
  },
  {
    id: "shore",
    label: "the water's edge",
    x: 0,
    z: -35,
    radius: 3,
    description: "You can walk down the beach and wade into the shallows",
  },
  {
    id: "entrance",
    label: "the entrance",
    x: 0,
    z: 11,
    radius: 2.5,
    description: "It's where you first arrived",
  },
];

export const PLACE_BY_ID = new Map(PLACES.map((place) => [place.id, place]));

const go = (node: GuideNodeId): GuideAction => ({ kind: "node", node });

/** The three ways into a conversation, offered whenever she has nothing else to suggest. */
export const ENTRY_CHOICES: readonly GuideChoice[] = [
  { label: "What is Plaza?", action: go("about") },
  { label: "How do I use it?", action: go("whatCan") },
  { label: "Show me around", action: go("places") },
];

const MORE_CONTROLS: GuideChoice = {
  label: "Other controls",
  action: go("controls"),
};
const TO_PLACES: GuideChoice = {
  label: "Show me around",
  action: go("places"),
};

export function reply(node: GuideNodeId, context: GuideContext): GuideReply {
  switch (node) {
    case "greeting":
      return {
        text: "Welcome! I'm Nagi. Ask me if you need a hand.",
        choices: [...ENTRY_CHOICES],
      };
    case "about":
      return {
        text: `Plaza is a shared beach where you can explore, play with found objects, and meet neighbors.${context.exhibits > 0 ? " There are shared apps on display." : " There are no app displays right now; you can share an app link in Talk."}`,
        choices: [
          { label: "How do I use it?", action: go("whatCan") },
          TO_PLACES,
        ],
      };
    case "whatCan":
      return {
        text: "Let me show you what you can do. Would you like to start with the controls, or with a tour of the place?",
        choices: [
          { label: "The controls", action: go("controls") },
          { label: "A tour", action: go("places") },
          { label: "Talking and posting", action: go("talk") },
        ],
      };
    case "controls":
      return {
        text: "Which control is giving you trouble? Pick the closest one, or just tell me in your own words.",
        choices: [
          { label: "Moving", action: go("move") },
          { label: "Looking around", action: go("look") },
          { label: "Jumping", action: go("jump") },
          { label: "Talking", action: go("talk") },
          { label: "Reactions", action: go("react") },
          ...(context.hasTimesOfDay
            ? [{ label: "Time of day and worlds", action: go("timeAndWorld") }]
            : []),
          { label: "Name and icon", action: go("profile") },
        ],
      };
    case "move": {
      const how = context.touch
        ? "Push the stick at the bottom left to walk."
        : context.engaged
          ? "Use the W, A, S and D keys to walk."
          : "Click the view once, then use the W, A, S and D keys to walk.";
      return {
        text: `${how} You can walk down the beach and right into the shallows.`,
        choices: [
          { label: "Let me try", action: { kind: "practice", skill: "move" } },
          MORE_CONTROLS,
          TO_PLACES,
        ],
      };
    }
    case "look": {
      const how = context.touch
        ? "Drag on the right side of the screen to look around."
        : context.lookMode === "drag"
          ? "Drag across the view to look around."
          : "Click the view, then move the mouse to look around. Press Esc to let go.";
      return {
        text: how,
        choices: [
          { label: "Let me try", action: { kind: "practice", skill: "look" } },
          MORE_CONTROLS,
        ],
      };
    }
    case "jump": {
      const how = context.touch
        ? "Tap the Jump button on the right"
        : "Press Space";
      return {
        text: `${how} to jump. It works while you walk, too, and you can land on the fountain's rim.`,
        choices: [
          { label: "Let me try", action: { kind: "practice", skill: "jump" } },
          {
            label: "Go to the fountain",
            action: { kind: "place", place: "fountain" },
          },
          MORE_CONTROLS,
        ],
      };
    }
    case "talk":
      if (!context.canPost) {
        return {
          text: 'You\'ll need to sign in to talk or post. Use "Sign in to talk" at the bottom right.',
          choices: [MORE_CONTROLS, TO_PLACES],
        };
      }
      return {
        text: context.touch
          ? "Tap Talk at the bottom right to talk to people nearby. What you send stays for everyone to see."
          : "Press Talk at the bottom right, or Enter, to talk to people nearby. What you send stays for everyone to see.",
        choices: [
          { label: "Let me try", action: { kind: "practice", skill: "talk" } },
          { label: "Reactions", action: go("react") },
          MORE_CONTROLS,
        ],
      };
    case "react": {
      const how = context.touch
        ? "Face someone and tap an emoji at the bottom right to react."
        : "Face someone and press an emoji at the bottom right, or keys 1 to 4, to react.";
      const nobody =
        context.peopleNearby === 0
          ? " There's no one nearby right now, so give it a try when someone comes by."
          : "";
      return {
        text: how + nobody,
        choices: [
          ...(context.peopleNearby > 0
            ? [
                {
                  label: "Let me try",
                  action: { kind: "practice", skill: "react" },
                } as GuideChoice,
              ]
            : []),
          { label: "Talking", action: go("talk") },
          MORE_CONTROLS,
        ],
      };
    }
    case "timeAndWorld":
      return {
        text: `From the Menu (${context.touch ? "top left" : "or the M key"}) you can choose a lighting override or the shared clock. Neighbors, tides and weather follow the shared clock. The lookout, tide pools, pier and camp are all a walk away.`,
        choices: [
          {
            label: "Open the Menu",
            action: { kind: "menu", section: "world" },
          },
          MORE_CONTROLS,
        ],
      };
    case "profile":
      return {
        text: 'You can change your name and icon under "You" in the Menu.',
        choices: [
          {
            label: "Open the Menu",
            action: { kind: "menu", section: "profile" },
          },
          MORE_CONTROLS,
        ],
      };
    case "places":
      return {
        text: "Where would you like to go?",
        choices: PLACES.filter(
          (place) => place.id !== "exhibits" || context.exhibits > 0,
        ).map((place) => ({
          label: capitalize(place.label),
          action: { kind: "place", place: place.id },
        })),
      };
    case "unclear":
      return {
        text: "Could you tell me a little more? Is it a question about how things work, or are you looking for a place?",
        choices: [
          { label: "How things work", action: go("controls") },
          { label: "A place", action: go("places") },
          { label: "What is Plaza?", action: go("about") },
        ],
      };
    case "thanks":
      return {
        text: "You're welcome. If there's anything else you'd like to know, just come and ask.",
        choices: [
          { label: "Close", action: { kind: "close" } },
          ...ENTRY_CHOICES,
        ],
      };
  }
}

/** Before setting off for a place: what it is, and the go button. */
export function departure(place: Place): GuideReply {
  return {
    text: `${capitalize(place.label)}. ${place.description}. I'll take you there. Press "Let's go" when you're ready.`,
    choices: [
      { label: "Let's go", action: { kind: "go", place: place.id } },
      { label: "Somewhere else", action: go("places") },
    ],
  };
}

/** What she says once you have done what you came for. */
export const SUCCESS_LINE =
  "You did it. If there's anything else you'd like to know, just come and ask.";

/** What each practice asks you to do, shown while you try. */
export const PRACTICE_PROMPTS: Record<PracticeSkill, string> = {
  move: "Try walking a few steps.",
  look: "Try looking all the way around.",
  jump: "Try a jump right where you are.",
  talk: "Try opening the talk box.",
  react: "Try sending a reaction to someone nearby.",
};

/** Phrases → where the conversation should go. Order matters: specific first. */
const INTENTS: readonly [RegExp, GuideNodeId | { place: PlaceId }][] = [
  [/潮だまり|貝|カニ|pool|shell|crab/i, { place: "pools" }],
  [/高台|展望|lookout|overlook/i, { place: "lookout" }],
  [/桟橋|木片|pier|driftwood/i, { place: "pier" }],
  [/キャンプ|雨宿り|焚き火|camp|shelter/i, { place: "camp" }],
  [/thank|cheers|got it|ありがと|助かった|わかった|できた/i, "thanks"],
  [/噴水|fountain/i, { place: "fountain" }],
  [/展示|アプリ|app|exhibit/i, { place: "exhibits" }],
  [/海|浜|波|浅瀬|beach|sea|shore/i, { place: "shore" }],
  [/入口|最初|スタート|entrance|spawn/i, { place: "entrance" }],
  [/移動|歩|動け|進め|走|move|walk/i, "move"],
  [/視点|見回|見渡|カメラ|向き|マウス|look|camera/i, "look"],
  [/ジャンプ|跳|飛|jump/i, "jump"],
  [/投稿|話|チャット|書き込|メッセージ|会話|talk|chat|post/i, "talk"],
  [/リアクション|絵文字|react|emoji/i, "react"],
  [/時間|夕焼け|夜|昼|ワールド|world|sunset|time/i, "timeAndWorld"],
  [/名前|アイコン|プロフィール|name|avatar|profile/i, "profile"],
  [
    /where|place|go to|take me|tour|show me around|場所|どこ|案内|行き|連れて/i,
    "places",
  ],
  [
    /what can|how|help|stuck|lost|confus|don'?t know|できる|使い方|操作|わからない|困|教えて/i,
    "whatCan",
  ],
  [/plaza|what is this|what'?s this|プラザ|ここ(は|って)|なに|何/i, "about"],
];

export type GuideIntent = { node: GuideNodeId } | { place: PlaceId };

/** Free text → intent. Anything unrecognised asks a clarifying question. */
export function understand(text: string): GuideIntent {
  const trimmed = text.trim();
  if (!trimmed) return { node: "unclear" };
  for (const [pattern, target] of INTENTS) {
    if (pattern.test(trimmed)) {
      return typeof target === "string"
        ? { node: target }
        : { place: target.place };
    }
  }
  return { node: "unclear" };
}
