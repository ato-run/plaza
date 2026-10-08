import { describe, it, expect } from "vitest";
import { mantleTarget } from "./mantle";
import { box, circle } from "../collision";
describe("low ledge mantle", () => {
  const bench = { ...box(0, 0, 3.1, 0.7), top: 0.78 };
  it("finds a real bench surface when jumping toward it", () => {
    expect(mantleTarget({ x: 0, z: 1 }, { x: 0, z: -1 }, 0, [bench])?.top).toBe(
      0.78,
    );
  });
  it("does not pull onto a wall or a ledge taller than one metre", () => {
    expect(
      mantleTarget({ x: 0, z: 1 }, { x: 0, z: -1 }, 0, [
        { ...bench, top: 1.1 },
      ]),
    ).toBeNull();
    expect(
      mantleTarget({ x: 0, z: 1 }, { x: 0, z: -1 }, 0, [box(0, 0, 3, 0.7)]),
    ).toBeNull();
  });
  it("rejects a surface occupied by another solid object or outside the coast", () => {
    expect(
      mantleTarget({ x: 0, z: 1 }, { x: 0, z: -1 }, 0, [
        bench,
        circle(0, 0, 1),
      ]),
    ).toBeNull();
    expect(
      mantleTarget({ x: 0, z: 1 }, { x: 0, z: -1 }, 0, [bench], () => false),
    ).toBeNull();
  });
  it("never moves a stationary visitor or steps in the opposite direction", () => {
    expect(mantleTarget({ x: 0, z: 1 }, { x: 0, z: 0 }, 0, [bench])).toBeNull();
    expect(mantleTarget({ x: 0, z: 1 }, { x: 0, z: 1 }, 0, [bench])).toBeNull();
  });
});
