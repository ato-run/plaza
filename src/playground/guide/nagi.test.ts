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
  "greeting",
  "about",
  "whatCan",
  "controls",
  "move",
  "look",
  "jump",
  "talk",
  "react",
  "timeAndWorld",
  "profile",
  "places",
  "unclear",
  "thanks",
];

describe("Nagi", () => {
  it("opens with the greeting and the three entry points", () => {
    const greeting = reply("greeting", desktop);
    expect(greeting.text).toBe("Welcome! I'm Nagi. Ask me if you need a hand.");
    expect(greeting.choices.map((choice) => choice.label)).toEqual([
      "What is Plaza?",
      "How do I use it?",
      "Show me around",
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
    expect(reply("move", phone).text).toContain("stick");
    expect(reply("move", desktop).text).toContain("W, A, S and D");
    expect(reply("move", { ...desktop, engaged: false }).text).toContain(
      "Click",
    );
    expect(reply("jump", phone).text).toContain("Jump button");
    expect(reply("jump", desktop).text).toContain("Space");
    expect(reply("look", { ...desktop, lookMode: "drag" }).text).toContain(
      "Drag",
    );
  });

  it("does not offer what cannot be done right now", () => {
    expect(reply("talk", { ...desktop, canPost: false }).text).toContain(
      "sign in",
    );
    expect(
      reply("react", desktop).choices.some(
        (choice) => choice.action.kind === "practice",
      ),
    ).toBe(false);
    expect(
      reply("react", { ...desktop, peopleNearby: 2 }).choices[0].action,
    ).toEqual({
      kind: "practice",
      skill: "react",
    });
    const places = reply("places", desktop).choices.map(
      (choice) => choice.label,
    );
    expect(places).not.toContain("The app exhibits");
    expect(
      reply("places", { ...desktop, exhibits: 3 }).choices.map((c) => c.label),
    ).toContain("The app exhibits");
  });

  it("asks you to press Let's go before leading the way", () => {
    const fountain = departure(PLACE_BY_ID.get("fountain")!);
    expect(fountain.text).toContain(
      `I'll take you there. Press "Let's go" when you're ready.`,
    );
    expect(fountain.choices[0]).toEqual({
      label: "Let's go",
      action: { kind: "go", place: "fountain" },
    });
  });

  it("routes free text to the right help", () => {
    expect(understand("What can I do here?")).toEqual({ node: "whatCan" });
    expect(understand("I don't know how to move")).toEqual({ node: "move" });
    expect(understand("I want to post something")).toEqual({ node: "talk" });
    expect(understand("how do I jump")).toEqual({ node: "jump" });
    expect(understand("take me to the fountain")).toEqual({
      place: "fountain",
    });
    expect(understand("I want to go to the beach")).toEqual({ place: "shore" });
    expect(understand("where should I go?")).toEqual({ node: "places" });
    expect(understand("What is Plaza?")).toEqual({ node: "about" });
    expect(understand("thanks!")).toEqual({ node: "thanks" });
    // Japanese still works for visitors who type it.
    expect(understand("移動の仕方がわからない")).toEqual({ node: "move" });
    expect(understand("qwerty")).toEqual({ node: "unclear" });
    expect(reply("unclear", desktop).text).toBe(
      "Could you tell me a little more? Is it a question about how things work, or are you looking for a place?",
    );
  });
});
