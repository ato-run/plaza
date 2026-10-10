import { describe, it, expect } from "vitest";
import {
  Vector3,
  Group,
  Mesh,
  BoxGeometry,
  MeshBasicMaterial,
  Raycaster,
} from "three";
import {
  resolveTarget,
  occludesTarget,
  targetKey,
  type WorldTarget,
} from "./interaction";
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
  it.each<WorldTarget>([
    { kind: "guide", guideId: "nagi", name: "Nagi" },
    { kind: "mascot", mascotId: "koala", name: "Sora" },
    { kind: "person", principalId: "visitor", name: "Visitor" },
  ])(
    "keeps a character target visible through its own model: $kind",
    (target) => {
      const character = new Group();
      character.userData.interactionTargets = [targetKey(target)];
      const head = new Mesh(
        new BoxGeometry(0.85, 0.85, 0.85),
        new MeshBasicMaterial(),
      );
      head.position.set(0, 1.45, -2);
      character.add(head);
      character.updateMatrixWorld(true);
      const point = new Vector3(0, 1.45, -2),
        direction = point.clone().sub(eye).normalize();
      const hits = new Raycaster(
        eye,
        direction,
        0,
        eye.distanceTo(point) - 0.32,
      ).intersectObject(character, true);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.some((hit) => occludesTarget(hit.object, target))).toBe(
        false,
      );
      expect(
        hits.some((hit) =>
          occludesTarget(hit.object, {
            kind: "object",
            objectId: "shell",
            title: "Shell",
          }),
        ),
      ).toBe(true);
      head.geometry.dispose();
      head.material.dispose();
    },
  );
  it("selects a seat through its own backrest while the same furniture hides other targets", () => {
    const bench = new Group();
    bench.userData.interactionTargets = ["seat:camp-seat-0"];
    const back = new Mesh(
      new BoxGeometry(2.6, 0.6, 0.15),
      new MeshBasicMaterial(),
    );
    back.position.set(0, 0.8, -1.65);
    bench.add(back);
    bench.updateMatrixWorld(true);
    const seat: Interactable = {
      kind: "seat",
      id: "camp-seat-0",
      title: "Sit",
      anchor: new Vector3(0, 0.56, -2),
      maxDistance: 2.5,
    };
    const direction = seat.anchor.clone().sub(eye).normalize();
    const ray = new Raycaster(
      eye,
      direction,
      0,
      eye.distanceTo(seat.anchor) - 0.32,
    );
    const hits = ray.intersectObject(bench, true);
    expect(hits.length).toBeGreaterThan(0);
    const visible = (
      _point: { x: number; y: number; z: number },
      target: Parameters<typeof occludesTarget>[1],
    ) => !hits.some((hit) => occludesTarget(hit.object, target));
    expect(resolveTarget(eye, direction, [], [seat], visible)).toMatchObject({
      seatId: seat.id,
    });
    expect(
      visible(seat.anchor, {
        kind: "object",
        objectId: "shell",
        title: "Pick up shell",
      }),
    ).toBe(false);
    expect(
      visible(seat.anchor, {
        kind: "seat",
        seatId: "camp-seat-2",
        title: "Sit",
      }),
    ).toBe(false);
    bench.visible = false;
    expect(
      visible(seat.anchor, {
        kind: "object",
        objectId: "shell",
        title: "Pick up shell",
      }),
    ).toBe(true);
    back.geometry.dispose();
    back.material.dispose();
  });
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
