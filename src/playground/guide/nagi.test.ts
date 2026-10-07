import { describe, expect, it } from "vitest";

import {
  departure,
  ENTRY_CHOICES,
  PLACE_BY_ID,
  reply,
  understand,
  type GuideContext,
  type GuideNodeId,
} from "./nagi";

const desktop: GuideContext = {
  touch: false,
  lookMode: "lock",
  engaged: true,
  canPost: true,
  peopleNearby: 0,
  exhibits: 0,
  hasTimesOfDay: true,
};
const phone: GuideContext = { ...desktop, touch: true };

const ALL: GuideNodeId[] = [
  "greeting", "about", "whatCan", "controls", "move", "look", "jump",
  "talk", "react", "timeAndWorld", "profile", "places", "unclear", "thanks",
];

describe("ナギ", () => {
  it("opens with the greeting and the three entry points", () => {
    const greeting = reply("greeting", desktop);
    expect(greeting.text).toBe(
      "ようこそ、Plazaへ。案内役のナギです。使い方や場所について、気軽に聞いてください。",
    );
    expect(greeting.choices.map((choice) => choice.label)).toEqual([
      "Plazaって？",
      "使い方を教えて",
      "場所を案内して",
    ]);
    expect(ENTRY_CHOICES).toHaveLength(3);
  });

  it("always offers something to do next", () => {
    for (const context of [desktop, phone, { ...desktop, canPost: false }]) {
      for (const node of ALL) {
        expect(reply(node, context).choices.length, node).toBeGreaterThan(0);
      }
    }
  });

  it("explains the controls of the device in hand", () => {
    expect(reply("move", phone).text).toContain("スティック");
    expect(reply("move", desktop).text).toContain("W・A・S・D");
    expect(reply("move", { ...desktop, engaged: false }).text).toContain("クリック");
    expect(reply("jump", phone).text).toContain("Jump ボタン");
    expect(reply("jump", desktop).text).toContain("Space");
    expect(reply("look", { ...desktop, lookMode: "drag" }).text).toContain("ドラッグ");
  });

  it("does not offer what cannot be done right now", () => {
    expect(reply("talk", { ...desktop, canPost: false }).text).toContain("サインイン");
    expect(reply("react", desktop).choices.some((choice) => choice.action.kind === "practice")).toBe(false);
    expect(reply("react", { ...desktop, peopleNearby: 2 }).choices[0].action).toEqual({
      kind: "practice",
      skill: "react",
    });
    const places = reply("places", desktop).choices.map((choice) => choice.label);
    expect(places).not.toContain("アプリの展示");
    expect(reply("places", { ...desktop, exhibits: 3 }).choices.map((c) => c.label)).toContain("アプリの展示");
  });

  it("asks you to press 出発 before leading the way", () => {
    const fountain = departure(PLACE_BY_ID.get("fountain")!);
    expect(fountain.text).toContain("そこまで案内しますね。準備ができたら「出発」を押してください。");
    expect(fountain.choices[0]).toEqual({ label: "出発", action: { kind: "go", place: "fountain" } });
  });

  it("routes free text to the right help", () => {
    expect(understand("何ができる？")).toEqual({ node: "whatCan" });
    expect(understand("移動の仕方がわからない")).toEqual({ node: "move" });
    expect(understand("投稿したい")).toEqual({ node: "talk" });
    expect(understand("ジャンプってどうやるの")).toEqual({ node: "jump" });
    expect(understand("噴水に行きたい")).toEqual({ place: "fountain" });
    expect(understand("海に行きたい")).toEqual({ place: "shore" });
    expect(understand("どこに何があるの")).toEqual({ node: "places" });
    expect(understand("Plazaって何？")).toEqual({ node: "about" });
    expect(understand("ありがとう")).toEqual({ node: "thanks" });
    expect(understand("qwerty")).toEqual({ node: "unclear" });
    expect(reply("unclear", desktop).text).toBe(
      "もう少し教えてください。使い方の質問ですか？ それとも、場所を探していますか？",
    );
  });
});
