import { describe, expect, it } from "vitest";
import { conversationNpc } from "./conversationTarget";
import { residentReaction } from "./world/residents/reaction";
import { RESIDENT_PROFILES } from "./guide/residents";

describe("shared Talk and reaction controls", () => {
  it("routes residents and the guide to their conversation, keeping human chat public", () => {
    expect(conversationNpc({kind: "mascot", mascotId: "owl", name: "Olive"})).toBe("owl");
    expect(conversationNpc({kind: "guide", guideId: "nagi", name: "Nagi"})).toBe("nagi");
    expect(conversationNpc({kind: "person", principalId: "user1234", name: "Alex"})).toBeNull();
    expect(conversationNpc(null)).toBeNull();
  });
  it("all ten residents acknowledge all four supported reactions in character", () => {
    for (const resident of RESIDENT_PROFILES) {
      for (const emoji of ["👋", "❤️", "😂", "👍"]) {
        expect(residentReaction(resident.personality, emoji)).toContain(emoji);
      }
      expect(residentReaction(resident.personality, "unknown")).toBeNull();
    }
    expect(residentReaction("cranky", "❤️")).not.toBe(residentReaction("peppy", "❤️"));
  });
});
