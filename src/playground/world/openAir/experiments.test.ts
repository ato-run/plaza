import { describe, expect, it } from "vitest";
import {
  applyOpenAir,
  emptyOpenAir,
  heldItem,
  ITEMS,
  ITEM_BY_ID,
  itemPosition,
  restoreOpenAir,
  shellArrangement,
  type ItemState,
  type OpenAirState,
} from "./model";
import { freeObjectPosition, objectGround } from "./physics";
import { DAY_MS, worldMoment } from "./clock";
import {
  CAMP_SEATS,
  CANOPY_POLES,
  OPEN_AIR_PLACES,
  sheltered,
  TRAY,
} from "./layout";
import { actionWasApplied, interactionError } from "./feedback";
import { normalizeSettings, DEFAULT_KEYS, rebindKey } from "./settings";
import { spatialPan } from "./audio";
const at = DAY_MS * 100;
const stateWith = (id: string, saved: ItemState): OpenAirState => ({
  ...emptyOpenAir(),
  objects: { [id]: saved },
});
const held = (x = 0, z = 10): ItemState => ({
  owner: "a",
  actor: "a",
  at,
  x,
  z,
  vx: 0,
  vz: 0,
});

describe("physical experiments survive the shared operation log", () => {
  it("light cargo follows floating wood while a heavy off-centre load falls", () => {
    const wood = ITEM_BY_ID.get("wood-1")!,
      shell = ITEM_BY_ID.get("shell-0")!;
    let state: OpenAirState = {
      ...emptyOpenAir(),
      objects: {
        [wood.id]: { owner: null, at, x: 0, z: -44, vx: 0, vz: 0, vy: 0 },
        [shell.id]: held(),
      },
    };
    const p = itemPosition(wood, state.objects[wood.id], at + 1000, state);
    state = applyOpenAir(state, 1, "a", at + 1000, {
      kind: "place",
      id: shell.id,
      x: p.x + 0.1,
      z: p.z,
      vx: 0,
      vz: 0,
      support: wood.id,
    });
    expect(state.objects[shell.id].support).toBe(wood.id);
    const boat = itemPosition(wood, state.objects[wood.id], at + 30000, state),
      cargo = itemPosition(shell, state.objects[shell.id], at + 30000, state);
    expect(cargo.x - boat.x).toBeCloseTo(0.1);
    state = {
      ...state,
      objects: { ...state.objects, "stone-0": { ...held(), at: at + 30000 } },
    };
    state = applyOpenAir(state, 2, "a", at + 30000, {
      kind: "place",
      id: "stone-0",
      x: boat.x + 0.55,
      z: boat.z,
      vx: 0,
      vz: 0,
      support: wood.id,
    });
    expect(state.objects["stone-0"].support).toBeUndefined();
    expect(state.objects[shell.id].support).toBeUndefined();
  });
  it("renewal keeps an active holder past ninety seconds and only that holder can renew", () => {
    let state = stateWith("stone-0", held());
    for (let i = 1; i <= 12; i++)
      state = applyOpenAir(state, i, "a", at + i * 10000, {
        kind: "renew",
        id: "stone-0",
        x: 3,
        z: 10,
      });
    expect(heldItem(state, "a", at + 120001)).toBe("stone-0");
    const rejected = applyOpenAir(state, 13, "b", at + 120002, {
      kind: "renew",
      id: "stone-0",
      x: 20,
      z: 10,
    });
    expect(rejected.objects).toBe(state.objects);
    expect(heldItem(rejected, "a", at + 210001)).toBeUndefined();
  });
  it("an upward release rises while a downward release falls, and a stronger throw travels farther", () => {
    const item = ITEM_BY_ID.get("stone-0")!;
    const launch: ItemState = {
      owner: null,
      at,
      x: 0,
      z: 12,
      y: 1.2,
      vx: 2,
      vz: 0,
      vy: 4,
    };
    expect(freeObjectPosition(item, launch, at + 200).y).toBeGreaterThan(
      freeObjectPosition(item, { ...launch, vy: -2 }, at + 200).y,
    );
    expect(
      freeObjectPosition(item, { ...launch, vx: 7 }, at + 500).x,
    ).toBeGreaterThan(freeObjectPosition(item, launch, at + 500).x + 1);
  });
  it("low fast stones skip and steep throws sink", () => {
    const item = ITEM_BY_ID.get("stone-0")!;
    const launch: ItemState = {
      owner: null,
      at,
      x: 0,
      z: -44,
      y: -0.4,
      vx: 7,
      vz: 0,
      vy: -0.6,
    };
    const skips = Array.from(
      { length: 40 },
      (_, i) => freeObjectPosition(item, launch, at + i * 50).skips,
    );
    expect(Math.max(...skips)).toBeGreaterThan(0);
    expect(
      freeObjectPosition(item, { ...launch, vy: -7 }, at + 1500).skips,
    ).toBe(0);
  });
  it("wind transitions cannot move a placed leaf discontinuously", () => {
    const front = 240000 * 2;
    const leaf = ITEM_BY_ID.get("leaf-0")!,
      saved: ItemState = {
        owner: null,
        at: front - 60000,
        x: 0,
        z: 12,
        vx: 0,
        vz: 0,
        vy: 0,
      };
    const a = freeObjectPosition(leaf, saved, front - 1),
      b = freeObjectPosition(leaf, saved, front + 1);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(0.01);
  });
  it("a stone pins a leaf; stacked objects follow the same bounded support after restore", () => {
    const leaf = ITEM_BY_ID.get("leaf-0")!,
      stone = ITEM_BY_ID.get("stone-0")!;
    let state: OpenAirState = {
      ...emptyOpenAir(),
      objects: {
        "leaf-0": { owner: null, at, x: 0, z: 12, vx: 0, vz: 0, vy: 0 },
        "stone-0": held(),
      },
    };
    const base = itemPosition(leaf, state.objects[leaf.id], at + 5000, state);
    state = applyOpenAir(state, 1, "a", at + 5000, {
      kind: "place",
      id: stone.id,
      x: base.x,
      z: base.z,
      vx: 0,
      vz: 0,
      support: leaf.id,
    });
    const pinned = itemPosition(
      leaf,
      state.objects[leaf.id],
      at + 55000,
      state,
    );
    expect(pinned.x).toBeCloseTo(base.x);
    expect(pinned.z).toBeCloseTo(base.z);
    const restored = restoreOpenAir(JSON.parse(JSON.stringify(state)));
    expect(
      itemPosition(stone, restored.objects[stone.id], at + 55000, restored),
    ).toEqual(itemPosition(stone, state.objects[stone.id], at + 55000, state));
    const cycle = restoreOpenAir({
      ...state,
      objects: {
        ...state.objects,
        [leaf.id]: {
          ...state.objects[leaf.id],
          support: stone.id,
          dx: 0,
          dz: 0,
        },
      },
    });
    expect(
      cycle.objects[leaf.id].support === stone.id &&
        cycle.objects[stone.id].support === leaf.id,
    ).toBe(false);
  });
  it("a thrown stone transfers momentum to a ball and a checkpoint preserves the collision", () => {
    let state: OpenAirState = {
      ...emptyOpenAir(),
      objects: {
        "stone-0": held(),
        "ball-0": {
          owner: null,
          at,
          x: 1,
          z: 12,
          y: 0.22,
          vx: 0,
          vz: 0,
          vy: 0,
          yaw: 0.3,
        },
      },
    };
    state = applyOpenAir(state, 1, "a", at, {
      kind: "throw",
      id: "stone-0",
      x: 0,
      z: 12,
      y: 0.22,
      vx: 5,
      vz: 0,
      vy: 0,
    });
    expect(state.objects["stone-0"].contact).toBeDefined();
    expect(state.objects["ball-0"].vx).toBeGreaterThan(0);
    const caught = applyOpenAir(state, 2, "b", at + 100, {
      kind: "take",
      id: "ball-0",
      x: 1,
      z: 12,
    });
    expect(caught.objects["ball-0"].owner).toBe("b");
    expect(caught.objects["stone-0"].contact).toBeUndefined();
    const restored = restoreOpenAir(JSON.parse(JSON.stringify(state)));
    expect(restored).toEqual(state);
    for (const id of ["stone-0", "ball-0"])
      for (const age of [100, 500, 2000])
        expect(
          itemPosition(
            ITEM_BY_ID.get(id)!,
            restored.objects[id],
            at + age,
            restored,
          ),
        ).toEqual(
          itemPosition(ITEM_BY_ID.get(id)!, state.objects[id], at + age, state),
        );
  });
  it("repair consumes a real held piece at the repair bench and cannot be repeated without material", () => {
    let state = stateWith("wood-1", held(23, 17));
    state = applyOpenAir(state, 1, "a", at, {
      kind: "repair",
      id: "bear",
      x: 23,
      z: 17,
    });
    expect(state.repairs?.["wood-1"]).toBe(at);
    expect(heldItem(state, "a", at)).toBeUndefined();
    expect(
      applyOpenAir(state, 2, "a", at + 1, {
        kind: "repair",
        id: "bear",
        x: 23,
        z: 17,
      }).repairs,
    ).toBe(state.repairs);
  });
  it("body pushes never affect held objects or objects beyond body reach", () => {
    const state = stateWith("ball-0", held());
    expect(
      applyOpenAir(state, 1, "b", at, {
        kind: "push",
        id: "ball-0",
        x: 0,
        z: 10,
        vx: 1,
        vz: 0,
      }).objects,
    ).toBe(state.objects);
    const free = stateWith("ball-0", { ...held(), owner: null });
    expect(
      applyOpenAir(free, 1, "b", at, {
        kind: "push",
        id: "ball-0",
        x: 8,
        z: 10,
        vx: 1,
        vz: 0,
      }).objects,
    ).toBe(free.objects);
  });
  it("recognizes actual shell lines and rings rather than the number of shells", () => {
    const arrange = (points: number[][]) => ({
      ...emptyOpenAir(),
      objects: Object.fromEntries(
        points.map(([x, z], i) => [
          `shell-${i}`,
          {
            owner: null,
            at,
            x: TRAY.x + x,
            z: TRAY.z + z,
            y: objectGround(TRAY.x + x, TRAY.z + z) + 0.045,
            vx: 0,
            vz: 0,
            vy: 0,
          },
        ]),
      ),
    });
    expect(
      shellArrangement(
        arrange([
          [-0.6, 0],
          [0, 0],
          [0.6, 0],
        ]),
        at,
      ),
    ).toBe("shell line");
    expect(
      shellArrangement(
        arrange([
          [0.6, 0],
          [0, 0.6],
          [-0.6, 0],
          [0, -0.6],
        ]),
        at,
      ),
    ).toBe("shell ring");
  });
  it("bounds sand marks and preserves only recent marks when another mark is made", () => {
    let state = emptyOpenAir();
    for (let i = 1; i <= 70; i++)
      state = applyOpenAir(state, i, "a", at + i, {
        kind: "mark",
        id: "sand",
        x: 0,
        z: 12,
        dx: 1,
        dz: 0,
      });
    expect(state.marks).toHaveLength(64);
    state = applyOpenAir(state, 71, "a", at + 46000, {
      kind: "mark",
      id: "sand",
      x: 0,
      z: 12,
      dx: 1,
      dz: 0,
    });
    expect(state.marks).toHaveLength(1);
  });
});
describe("playability boundaries", () => {
  it("keeps the landmark loop within fifteen metres of a physical experiment or destination", () => {
    const interests = [...ITEMS, ...OPEN_AIR_PLACES, { x: 0, z: 0 }];
    const loop = [
      OPEN_AIR_PLACES[0],
      OPEN_AIR_PLACES[1],
      OPEN_AIR_PLACES[2],
      OPEN_AIR_PLACES[3],
      OPEN_AIR_PLACES[0],
    ];
    for (let j = 1; j < loop.length; j++)
      for (let i = 0; i <= 40; i++) {
        const t = i / 40,
          x = loop[j - 1].x + (loop[j].x - loop[j - 1].x) * t,
          z = loop[j - 1].z + (loop[j].z - loop[j - 1].z) * t;
        expect(
          Math.min(...interests.map((p) => Math.hypot(p.x - x, p.z - z))),
        ).toBeLessThanOrEqual(15);
      }
  });
  it("uses the derivative to distinguish rising and falling tide", () => {
    expect(worldMoment(0).tideDirection).toBe("rising");
    expect(worldMoment(Math.PI * 180000).tideDirection).toBe("falling");
    expect(worldMoment((Math.PI / 2) * 180000).tideDirection).toBe("high");
  });
  it("camp seats face the sea and their sitting footprints clear the canopy poles", () => {
    for (const seat of CAMP_SEATS) {
      expect(seat.yaw).toBe(0);
      for (const pole of CANOPY_POLES)
        expect(Math.hypot(seat.x - pole.x, seat.z - pole.z)).toBeGreaterThan(1);
    }
    expect(sheltered(18, 1.6, 16)).toBe(true);
    expect(sheltered(18, 4, 16)).toBe(false);
    expect(sheltered(30, 1.6, 16)).toBe(false);
  });
  it("sanitizes corrupt settings and refuses reserved or duplicate keys", () => {
    expect(
      normalizeSettings({ fov: NaN, volume: 999, keys: { forward: "KeyM" } }),
    ).toMatchObject({ fov: 64, volume: 1, keys: { forward: "KeyW" } });
    expect(rebindKey({ ...DEFAULT_KEYS }, "forward", "KeyE")).toBeNull();
    expect(rebindKey({ ...DEFAULT_KEYS }, "forward", "KeyM")).toBeNull();
    expect(rebindKey({ ...DEFAULT_KEYS }, "forward", "KeyZ")?.forward).toBe(
      "KeyZ",
    );
  });
  it("cannot show committed success for a rejected or competing pickup", () => {
    const before = stateWith("stone-0", held());
    const action = { kind: "take", id: "stone-0", x: 0, z: 10 } as const;
    const after = applyOpenAir(before, 1, "b", at, action);
    expect(actionWasApplied(before, after, "b", action)).toBe(false);
    expect(interactionError(new Error("422 plaza_out_of_reach"))).toBe(
      "Move a little closer, then try again.",
    );
  });
  it("pans a world source to the correct ear while turning", () => {
    expect(spatialPan(0, 0, 10, 0, 0)).toBe(1);
    expect(spatialPan(0, 0, 10, 0, Math.PI)).toBe(-1);
    expect(spatialPan(0, 0, 0, -10, Math.PI / 2)).toBe(1);
  });
  it("offers an initial physical action within one step of the spawn", () => {
    expect(
      Math.min(
        ...ITEMS.filter((i) => i.kind === "ball").map((i) =>
          Math.hypot(i.x, i.z - 11),
        ),
      ),
    ).toBeLessThan(3);
  });
});
