import { describe, expect, it } from "vitest";

import { detectQuality, PixelRatioController, QUALITY_PROFILES } from "./quality";

describe("quality", () => {
  it("starts phones and weak machines on Low", () => {
    expect(detectQuality({ coarsePointer: true, shortSide: 390 })).toBe("low");
    expect(detectQuality({ coarsePointer: false, shortSide: 1080, cores: 4 })).toBe("low");
    expect(detectQuality({ coarsePointer: false, shortSide: 1080, cores: 10, memoryGb: 8 })).toBe("high");
  });

  it("drops the pixel ratio on a slow window and never below the floor", () => {
    const controller = new PixelRatioController(QUALITY_PROFILES.high, 2, 10);
    expect(controller.current).toBe(1.6);
    let changed: number | null = null;
    for (let window = 0; window < 10; window += 1) {
      for (let frame = 0; frame < 10; frame += 1) {
        const next = controller.sample(40);
        if (next !== null) changed = next;
      }
    }
    expect(changed).toBe(QUALITY_PROFILES.high.minPixelRatio);
    expect(controller.current).toBe(QUALITY_PROFILES.high.minPixelRatio);
  });

  it("needs two fast windows in a row to rise, so it cannot oscillate", () => {
    const controller = new PixelRatioController(QUALITY_PROFILES.high, 2, 10);
    for (let frame = 0; frame < 10; frame += 1) controller.sample(40);
    const dropped = controller.current;
    const results: (number | null)[] = [];
    for (let frame = 0; frame < 10; frame += 1) results.push(controller.sample(8));
    expect(controller.current).toBe(dropped);
    for (let frame = 0; frame < 10; frame += 1) results.push(controller.sample(8));
    expect(controller.current).toBeGreaterThan(dropped);
  });

  it("ignores frames from a backgrounded tab", () => {
    const controller = new PixelRatioController(QUALITY_PROFILES.low, 3, 5);
    for (let frame = 0; frame < 50; frame += 1) expect(controller.sample(1000)).toBeNull();
    expect(controller.current).toBe(QUALITY_PROFILES.low.maxPixelRatio);
  });
});
