import { describe, it, expect } from "vitest";
import { Vector3 } from "three";
import { resolveTarget } from "./interaction";
import type { Interactable } from "./types";
const eye = new Vector3(0, 1.6, 0),
  forward = new Vector3(0, 0, -1);
const small = (id: string, x: number, z: number): Interactable => ({
  kind: "object",
  id,
  title: `Pick up ${id}`,
  anchor: new Vector3(x, 1.5, z),
  maxDistance: 3.2,
});
describe("visible and stable physical selection", () => {
  it("does not select an otherwise eligible object through an obstruction", () => {
    expect(
      resolveTarget(eye, forward, [], [small("shell", 0, -2)], () => false),
    ).toBeNull();
    expect(
      resolveTarget(eye, forward, [], [small("shell", 0, -2)], () => true),
    ).toMatchObject({ objectId: "shell" });
  });
  it("allows a small object to be slightly off centre and still enforces reach", () => {
    expect(
      resolveTarget(eye, forward, [], [small("shell", 0.65, -2)]),
    ).toMatchObject({ objectId: "shell" });
    expect(
      resolveTarget(eye, forward, [], [small("shell", 0, -3.3)]),
    ).toBeNull();
  });
  it("retains the preferred target while visible and abandons it once occluded", () => {
    const a = small("a", 0.3, -2),
      b = small("b", 0, -2),
      preferred = {
        kind: "object",
        objectId: "a",
        title: "Pick up a",
      } as const;
    expect(
      resolveTarget(eye, forward, [], [a, b], () => true, preferred),
    ).toMatchObject({ objectId: "a" });
    expect(
      resolveTarget(eye, forward, [], [a, b], (p) => p.x === 0, preferred),
    ).toMatchObject({ objectId: "b" });
  });
});
