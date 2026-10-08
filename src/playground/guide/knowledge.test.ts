import { describe, expect, it } from "vitest";

import {
  CHOICE_CATALOG,
  choiceIdsFor,
  choicesFromIds,
  isNpcId,
  NPC_IDS,
  npcFallback,
  npcInstructions,
  npcProfile,
  plazaFacts,
  residentGreeting,
  responseContract,
} from "./knowledge";
import { LINES, RESIDENT_PROFILES } from "./residents";
import type { GuideContext } from "./nagi";

const context: GuideContext = {
  touch: false, lookMode: "lock", engaged: true, canPost: true,
  peopleNearby: 0, exhibits: 0, hasTimesOfDay: true,
};

describe("guide knowledge", () => {
  it("only lets known, currently usable choices through", () => {
    const out = choicesFromIds(
      ["node:move", "rm -rf", "place:exhibits", "practice:react", { kind: "go" }, "node:move", "place:fountain", "menu:profile"],
      context,
    );
    expect(out.map((choice) => choice.label)).toEqual(["Moving", "Go to the fountain", "Open the Menu (name and icon)"]);
    expect(choicesFromIds(["practice:react"], { ...context, peopleNearby: 2 })).toHaveLength(1);
    expect(choicesFromIds(["practice:talk"], { ...context, canPost: false })).toHaveLength(0);
  });

  it("maps every catalogued ID to an existing action, and lists them for the model", () => {
    for (const npc of NPC_IDS) {
      for (const id of choiceIdsFor(npc)) {
        expect(CHOICE_CATALOG[id].action.kind).toMatch(/^(node|practice|place|go|menu)$/);
        expect(responseContract(npc)).toContain(id);
      }
    }
  });

  it("states the controls of the visitor's device and what does not exist", () => {
    expect(plazaFacts({ ...context, touch: true, signedIn: true })).toContain("stick");
    expect(plazaFacts({ ...context, signedIn: false })).toContain("need signing in");
    expect(plazaFacts({ ...context, signedIn: true })).toContain("does NOT have");
  });

  it("lets residents only point the way or open the Menu, and Nagi never skip her description", () => {
    expect(choicesFromIds(["node:about", "place:fountain", "go:fountain", "menu:world"], context, "cat").map((c) => c.action.kind)).toEqual([
      "go",
      "menu",
    ]);
    expect(choicesFromIds(["go:fountain", "place:fountain"], context, "nagi").map((c) => c.action.kind)).toEqual(["place"]);
    expect(choicesFromIds(["go:exhibits"], context, "fox")).toHaveLength(0);
  });

  it("knows every resident by id, with their own persona and the shared facts", () => {
    expect(NPC_IDS).toHaveLength(1 + RESIDENT_PROFILES.length);
    expect(isNpcId("bear")).toBe(true);
    expect(isNpcId("dragon")).toBe(false);
    expect(isNpcId("__proto__")).toBe(false);
    for (const resident of RESIDENT_PROFILES) {
      const profile = npcProfile(resident.id);
      expect(profile.name).toBe(resident.name);
      expect(profile.role).toBe("Neighbor");
      expect(profile.persona).toContain(`You are ${resident.name}`);
      expect(profile.persona).toContain("Nagi");
      expect(npcInstructions(resident.id, { ...context, signedIn: true })).toContain("does NOT have");
    }
    expect(npcProfile("nagi").role).toBe("Guide");
  });

  it("answers without a model in each character's own words", () => {
    const talk = LINES.cranky.talk;
    const smallTalk = npcFallback("bear", "nice weather", context);
    expect(talk).toContain(smallTalk.text);
    expect(smallTalk.choices).toEqual([]);
    expect(npcFallback("bear", "how do I jump?", context).text).toContain("Nagi");
    expect(npcFallback("bear", "where is the fountain?", context).choices.map((c) => c.action)).toEqual([
      { kind: "go", place: "fountain" },
    ]);
    expect(npcFallback("nagi", "where is the fountain?", context).choices[0].action).toEqual({ kind: "go", place: "fountain" });
    expect(LINES.lazy.greet).toContain(residentGreeting("cat", 7).text);
  });
});
