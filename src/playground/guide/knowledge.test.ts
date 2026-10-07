import { describe, expect, it } from "vitest";

import { CHOICE_CATALOG, CHOICE_IDS, choicesFromIds, plazaFacts, RESPONSE_CONTRACT } from "./knowledge";
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
    for (const id of CHOICE_IDS) {
      expect(CHOICE_CATALOG[id].action.kind).toMatch(/^(node|practice|place|menu)$/);
      expect(RESPONSE_CONTRACT).toContain(id);
    }
  });

  it("states the controls of the visitor's device and what does not exist", () => {
    expect(plazaFacts({ ...context, touch: true, signedIn: true })).toContain("stick");
    expect(plazaFacts({ ...context, signedIn: false })).toContain("need signing in");
    expect(plazaFacts({ ...context, signedIn: true })).toContain("does NOT have");
  });
});
