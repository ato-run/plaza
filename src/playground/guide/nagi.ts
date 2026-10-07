/**
 * ナギ — Plaza's guide. What she says, and what each answer lets you do next.
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
  /** Pick a place: she describes it and offers 「出発」. */
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
export type PlaceId = "fountain" | "exhibits" | "shore" | "entrance";

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

/** Where she can take you. Coordinates are the plaza's (see centralGeometry). */
export const PLACES: readonly Place[] = [
  { id: "fountain", label: "噴水", x: 0, z: 0, radius: 4.6, description: "広場の真ん中です。ジャンプすると縁に乗れます" },
  { id: "exhibits", label: "アプリの展示", x: 0, z: -12, radius: 3.2, description: "みんなが共有したアプリが並ぶ場所です" },
  { id: "shore", label: "波打ち際", x: 0, z: -35, radius: 3, description: "砂浜を下りて、浅瀬まで入れます" },
  { id: "entrance", label: "入口", x: 0, z: 11, radius: 2.5, description: "最初に立っていた場所です" },
];

export const PLACE_BY_ID = new Map(PLACES.map((place) => [place.id, place]));

const go = (node: GuideNodeId): GuideAction => ({ kind: "node", node });

/** The three ways into a conversation, offered whenever she has nothing else to suggest. */
export const ENTRY_CHOICES: readonly GuideChoice[] = [
  { label: "Plazaって？", action: go("about") },
  { label: "使い方を教えて", action: go("whatCan") },
  { label: "場所を案内して", action: go("places") },
];

const MORE_CONTROLS: GuideChoice = { label: "ほかの操作", action: go("controls") };
const TO_PLACES: GuideChoice = { label: "場所を案内して", action: go("places") };

export function reply(node: GuideNodeId, context: GuideContext): GuideReply {
  switch (node) {
    case "greeting":
      return {
        text: "ようこそ、Plazaへ。案内役のナギです。使い方や場所について、気軽に聞いてください。",
        choices: [...ENTRY_CHOICES],
      };
    case "about":
      return {
        text: "Plazaは、みんなが集まる一つの広場です。歩いて、近くの人と話して、展示されたアプリを試せます。",
        choices: [
          { label: "使い方を教えて", action: go("whatCan") },
          TO_PLACES,
          { label: "何ができる？", action: go("whatCan") },
        ],
      };
    case "whatCan":
      return {
        text: "できることを紹介しますね。まずは、操作方法と場所の案内、どちらから知りたいですか？",
        choices: [
          { label: "操作方法", action: go("controls") },
          { label: "場所の案内", action: go("places") },
          { label: "話す・投稿する", action: go("talk") },
        ],
      };
    case "controls":
      return {
        text: "どの操作で困っていますか？ 近いものを選ぶか、そのまま文章で教えてください。",
        choices: [
          { label: "移動", action: go("move") },
          { label: "見回す", action: go("look") },
          { label: "ジャンプ", action: go("jump") },
          { label: "話す・投稿", action: go("talk") },
          { label: "リアクション", action: go("react") },
          ...(context.hasTimesOfDay
            ? [{ label: "時間帯・ワールド", action: go("timeAndWorld") }]
            : []),
          { label: "名前・アイコン", action: go("profile") },
        ],
      };
    case "move": {
      const how = context.touch
        ? "左下のスティックを倒すと歩けます。"
        : context.engaged
          ? "W・A・S・D キーで歩けます。"
          : "画面を一度クリックしてから、W・A・S・D キーで歩けます。";
      return {
        text: `${how}砂浜を下りて、浅瀬まで入れますよ。`,
        choices: [
          { label: "やってみる", action: { kind: "practice", skill: "move" } },
          MORE_CONTROLS,
          TO_PLACES,
        ],
      };
    }
    case "look": {
      const how = context.touch
        ? "画面の右側をドラッグすると、周りを見渡せます。"
        : context.lookMode === "drag"
          ? "画面をドラッグすると、周りを見渡せます。"
          : "画面をクリックしたあと、マウスを動かすと周りを見渡せます。Esc で解除できます。";
      return {
        text: how,
        choices: [
          { label: "やってみる", action: { kind: "practice", skill: "look" } },
          MORE_CONTROLS,
        ],
      };
    }
    case "jump": {
      const how = context.touch ? "右の Jump ボタン" : "Space キー";
      return {
        text: `${how}でジャンプできます。歩きながらでも跳べて、噴水の縁にも乗れます。`,
        choices: [
          { label: "やってみる", action: { kind: "practice", skill: "jump" } },
          { label: "噴水へ行く", action: { kind: "place", place: "fountain" } },
          MORE_CONTROLS,
        ],
      };
    }
    case "talk":
      if (!context.canPost) {
        return {
          text: "話したり投稿したりするには、サインインが必要です。右下の「Sign in to talk」から進めます。",
          choices: [MORE_CONTROLS, TO_PLACES],
        };
      }
      return {
        text: context.touch
          ? "右下の Talk を押すと、近くの人に話しかけられます。送った言葉はみんなに残ります。"
          : "右下の Talk か Enter キーで、近くの人に話しかけられます。送った言葉はみんなに残ります。",
        choices: [
          { label: "やってみる", action: { kind: "practice", skill: "talk" } },
          { label: "リアクション", action: go("react") },
          MORE_CONTROLS,
        ],
      };
    case "react": {
      const how = context.touch
        ? "話したい人の方を向いて、右下の絵文字を押すとリアクションできます。"
        : "話したい人の方を向いて、右下の絵文字か 1〜4 キーでリアクションできます。";
      const nobody = context.peopleNearby === 0 ? "今は近くに人がいないので、誰か来たら試してみてください。" : "";
      return {
        text: how + nobody,
        choices: [
          ...(context.peopleNearby > 0
            ? [{ label: "やってみる", action: { kind: "practice", skill: "react" } } as GuideChoice]
            : []),
          { label: "話す・投稿", action: go("talk") },
          MORE_CONTROLS,
        ],
      };
    }
    case "timeAndWorld":
      return {
        text: `Menu（${context.touch ? "左上" : "M キー"}）から、時間帯の昼・夕焼けや、ワールドを切り替えられます。時間帯はあなたの画面だけに反映されます。`,
        choices: [
          { label: "Menu を開く", action: { kind: "menu", section: "world" } },
          MORE_CONTROLS,
        ],
      };
    case "profile":
      return {
        text: "Menu の「You」で、名前とアイコンを変えられます。",
        choices: [
          { label: "Menu を開く", action: { kind: "menu", section: "profile" } },
          MORE_CONTROLS,
        ],
      };
    case "places":
      return {
        text: "どこへ案内しましょうか？",
        choices: PLACES.filter((place) => place.id !== "exhibits" || context.exhibits > 0).map(
          (place) => ({ label: place.label, action: { kind: "place", place: place.id } }),
        ),
      };
    case "unclear":
      return {
        text: "もう少し教えてください。使い方の質問ですか？ それとも、場所を探していますか？",
        choices: [
          { label: "使い方", action: go("controls") },
          { label: "場所", action: go("places") },
          { label: "Plazaって？", action: go("about") },
        ],
      };
    case "thanks":
      return {
        text: "どういたしまして。ほかにも知りたいことがあれば、声をかけてください。",
        choices: [{ label: "閉じる", action: { kind: "close" } }, ...ENTRY_CHOICES],
      };
  }
}

/** Before setting off for a place: what it is, and the go button. */
export function departure(place: Place): GuideReply {
  return {
    text: `${place.label}ですね。${place.description}。そこまで案内しますね。準備ができたら「出発」を押してください。`,
    choices: [
      { label: "出発", action: { kind: "go", place: place.id } },
      { label: "ほかの場所", action: go("places") },
    ],
  };
}

/** What she says once you have done what you came for. */
export const SUCCESS_LINE = "できましたね。ほかにも知りたいことがあれば、声をかけてください。";

/** What each practice asks you to do, shown while you try. */
export const PRACTICE_PROMPTS: Record<PracticeSkill, string> = {
  move: "少し歩いてみてください。",
  look: "ぐるっと周りを見渡してみてください。",
  jump: "その場でジャンプしてみてください。",
  talk: "話しかける画面を開いてみてください。",
  react: "近くの人にリアクションを送ってみてください。",
};

/** Phrases → where the conversation should go. Order matters: specific first. */
const INTENTS: readonly [RegExp, GuideNodeId | { place: PlaceId }][] = [
  [/ありがと|thank|助かった|わかった|できた/i, "thanks"],
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
  [/場所|どこ|案内|行き|連れて|place|where|guide/i, "places"],
  [/できる|使い方|操作|わからない|困|教えて|how|what can|help/i, "whatCan"],
  [/plaza|プラザ|ここ(は|って)|なに|何/i, "about"],
];

export type GuideIntent = { node: GuideNodeId } | { place: PlaceId };

/** Free text → intent. Anything unrecognised asks a clarifying question. */
export function understand(text: string): GuideIntent {
  const trimmed = text.trim();
  if (!trimmed) return { node: "unclear" };
  for (const [pattern, target] of INTENTS) {
    if (pattern.test(trimmed)) {
      return typeof target === "string" ? { node: target } : { place: target.place };
    }
  }
  return { node: "unclear" };
}
