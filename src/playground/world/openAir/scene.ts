import { coastalStone, stoneBlock } from "./stone";
import { nightVisibility } from "./lighting";
import * as THREE from "three";
import type { WorldBuilder } from "../primitives";
import type { Collider } from "../collision";
import { circle } from "../collision";
import type { Interactable } from "../types";
import { terrainHeight, SEA_LEVEL, shoreZ, landward } from "../beach/coast";
import {
  ITEMS,
  ITEM_BY_ID,
  heldItem,
  itemPosition,
  emptyOpenAir,
  activeLease,
  type OpenAirAction,
  type OpenAirState,
  type ResidentId,
} from "./model";
import {
  OPEN_AIR_PLACES,
  OVERLOOK_STEPS,
  HOP_ROCKS,
  LOOKOUT_ROCKS,
  CANOPY,
  CANOPY_POLES,
  sheltered,
  TRAY,
  landmarkGround,
  CAMP_SEATS,
  explorationColliders,
} from "./layout";
import { DISCOVERIES, encounterTitle, RESIDENT_NAMES } from "./notebook";
import { ITEM_PHYSICS, objectGround, supportsObject } from "./physics";
import { worldMoment, type WorldMoment } from "./clock";
export interface ExploreStatus {
  held: string | null;
  notice: string;
  place: string;
  moment: WorldMoment;
  memories: string[];
  observations: string[];
  connected: boolean;
  seated: string | null;
  pending?: boolean;
  charge?: number;
  rotation?: number;
  lighting?: string | null;
  companion?: {
    id: ResidentId;
    name: string;
    goal: string;
    phase: "walking" | "waiting" | "arrived";
  } | null;
  hint?: string;
}
export interface OpenAirRuntime {
  colliders: Collider[];
  interactables: Interactable[];
  takeSound(): "splash" | "chime" | null;
  bind(emit: (action: OpenAirAction) => void, shareApp?: () => void): void;
  setExhibitCount(count: number): void;
  setState(
    state: OpenAirState,
    self: string,
    offset: number,
    connected: boolean,
  ): void;
  setEye(
    eye: THREE.Vector3,
    forward: THREE.Vector3,
    crouching: boolean,
    moving: boolean,
  ): void;
  status(): ExploreStatus;
  useHeld(throwing: boolean): void;
  charge(on: boolean): void;
  cancelCharge(): void;
  rotateHeld(): void;
  mark(): void;
  highlight(id: string | null): void;
  feedback(text: string): void;
  pending(on: boolean): void;
  setLighting(id: string | null): void;
  supportHeight(x: number, z: number): number;
  surface(): "wood" | "stone" | "sand";
  stopEscort(): void;
  seat(): (typeof CAMP_SEATS)[number] | null;
  stand(): void;
  deliver(): void;
  escort(id: ResidentId, goal: "pools" | "camp" | "pier" | "lookout"): void;
  state(): OpenAirState;
  now(): number;
  setPeers(
    peers: ReadonlyMap<
      string,
      { x: number; z: number; y?: number; yaw?: number }
    >,
  ): void;
  peer(id: string): { x: number; z: number } | undefined;
  update(dt: number): void;
  dispose(): void;
}
function sign(
  builder: WorldBuilder,
  text: string,
  x: number,
  y: number,
  z: number,
  width = 2.5,
) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#18352f";
  ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = "#fff4ce";
  ctx.textAlign = "center";
  ctx.font = "bold 32px sans-serif";
  text
    .split("\n")
    .forEach((line, i) => ctx.fillText(line, 256, 70 + i * 55, 480));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  builder.trackResource(texture);
  const mesh = builder.track(
    new THREE.Mesh(
      new THREE.PlaneGeometry(width, width / 2),
      new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.85,
        side: THREE.FrontSide,
      }),
    ),
  );
  mesh.position.set(x, y, z + 0.015);
  const back = builder.track(new THREE.Mesh(mesh.geometry, mesh.material));
  back.position.set(x, y, z - 0.015);
  back.rotation.y = Math.PI;
  // Readable faces share a texture; the solid edge also blocks targeting through the board.
  builder.box(width, width / 2, 0.03, "#715941", x, y, z);
  return (next: string) => {
    ctx.fillStyle = "#18352f";
    ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = "#fff4ce";
    next
      .split("\n")
      .forEach((line, i) => ctx.fillText(line, 256, 70 + i * 55, 480));
    texture.needsUpdate = true;
  };
}
function signPost(
  builder: WorldBuilder,
  text: string,
  x: number,
  y: number,
  z: number,
  width = 2.5,
) {
  const update = sign(builder, text, x, y, z, width);
  builder.cylinder(0.045, 1.3, "#715941", x, y - 0.6, z);
  return update;
}
export function createOpenAir(
  builder: WorldBuilder,
  reducedMotion: boolean,
): OpenAirRuntime {
  let shared = emptyOpenAir(),
    self = "",
    offset = 0,
    connected = false,
    emit: (a: OpenAirAction) => void = () => {};
  let peers: ReadonlyMap<
    string,
    { x: number; z: number; y?: number; yaw?: number }
  > = new Map();
  let pendingAction = false,
    chargedAt = 0,
    heldYaw = 0,
    selectedId: string | null = null,
    lighting: string | null = null;
  let lastPush = 0,
    lastMark = 0;
  const lastEye = new THREE.Vector3();
  const eye = new THREE.Vector3(),
    forward = new THREE.Vector3(0, 0, -1);
  let crouching = false,
    moving = false,
    notice = "",
    lastPlace = "",
    lastTrace = 0,
    lastWet = false,
    lastObserved = 0,
    noticeAt = 0,
    previousNotice = "",
    ignoredSeatAt = -1,
    sound: "splash" | "chime" | null = null;
  const ground = (x: number, z: number) =>
    landmarkGround(x, z, terrainHeight(x, z));
  const colliders: Collider[] = explorationColliders(),
    interactables: Interactable[] = [];
  const stoneFinish = coastalStone(builder);
  const tideMarks: THREE.Mesh[] = [];
  // The same continuous perimeter has rocky, broken and planted sections.
  for (let i = 0; i < 9; i++) {
    const x = -47 + i * 0.55,
      z = 28 + i * 2.2;
    const rock = builder.blob(
      0.6 + (i % 3) * 0.2,
      "#938e7c",
      x,
      ground(x, z) + 0.2,
      z,
      1,
    );
    rock.scale.set(1.1, 1.5, 0.7);
    rock.material = stoneFinish;
    const top = ground(x, z) + 0.85;
    colliders.push({ ...circle(x, z, 0.55), top });
  }
  for (let i = 0; i < 18; i++) {
    const x = 29 + (i % 6) * 3,
      z = 43 + Math.floor(i / 6) * 2;
    const grass = builder.blob(0.24, "#8a9271", x, ground(x, z) + 0.1, z, 0);
    grass.scale.set(1.3, 0.7, 0.65);
  }
  // Broad steps make a walking route; the outer rocks provide the jumping route.
  for (const step of OVERLOOK_STEPS) {
    stoneBlock(
      builder,
      stoneFinish,
      step.width - 0.08,
      step.top + 0.17,
      step.depth - 0.08,
      step.x,
      (step.top - 0.25) / 2,
      step.z,
    );
  }
  stoneBlock(
    builder,
    stoneFinish,
    2.02,
    3.23,
    3.92,
    -35.75,
    (3.06 - 0.25) / 2,
    10.5,
  );
  const top = OVERLOOK_STEPS[OVERLOOK_STEPS.length - 1];
  signPost(
    builder,
    "Dune lookout\nPools ↗   Pier →",
    top.x + 1.2,
    top.top + 0.8,
    top.z + 2,
    1.4,
  );
  for (const rock of [...HOP_ROCKS, ...LOOKOUT_ROCKS]) {
    const m = builder.blob(
      rock.r,
      "#938e7c",
      rock.x,
      rock.top - rock.r * 0.65,
      rock.z,
      1,
    );
    m.scale.y = 0.7;
    m.material = stoneFinish;
    const band = builder.track(
      new THREE.Mesh(
        new THREE.RingGeometry(rock.r * 0.87, rock.r, 28),
        new THREE.MeshBasicMaterial({
          color: "#635f52",
          transparent: true,
          opacity: 0.3,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      ),
    );
    band.rotation.x = -Math.PI / 2;
    band.position.set(rock.x, -0.65, rock.z);
    band.userData.nonOccluding = true;
    tideMarks.push(band);
  }
  // Pier, with low edge rails and a landmark sail visible from the entrance.
  for (let i = 0; i < 52; i++)
    builder.box(
      3.6,
      0.15,
      0.4,
      i % 2 ? "#967b52" : "#a48c64",
      22,
      0.18,
      -23.5 - i * 0.42,
    );
  for (const x of [20.4, 23.6])
    for (const z of [-24, -28, -32, -37, -42, -45])
      builder.cylinder(0.12, 1.6, "#69543e", x, -0.3, z);
  builder.cylinder(0.085, 6.2, "#72543e", 23, 2.8, -43);
  const sail = builder.track(
    new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 2),
      builder.material("#eab065", { roughness: 0.8 }),
    ),
  );
  sail.position.set(23.75, 3.8, -43);
  sail.rotation.y = -0.2;
  signPost(builder, "Driftwood pier\nFloat wood in the sea", 22, 1.1, -23);
  const buoys = Array.from({ length: 9 }, (_, i) => {
    const g = builder.group();
    builder.cylinder(0.13, 0.26, "#ecb66c", 0, 0.08, 0, 12, g);
    builder.cylinder(0.135, 0.055, "#f1efdc", 0, 0.1, 0, 12, g);
    g.position.x = -28 + i * 7;
    return g;
  });
  // Two arches identify the cove, and low tide exposes a safe shoreward sandbar.
  for (const x of [-23, -14]) {
    builder.blob(1.4, "#968d7c", x, ground(x, -30) + 0.3, -30, 1);
    colliders.push({ ...circle(x, -30, 1), top: ground(x, -30) + 1.1 });
  }
  const arch = builder.track(
    new THREE.Mesh(
      new THREE.TorusGeometry(2.2, 0.34, 12, 40, Math.PI),
      stoneFinish,
    ),
  );
  arch.position.set(-18.5, 0.25, -29.5);
  for (const x of [-20.7, -16.3]) {
    builder.cylinder(0.32, 0.8, "#968d7c", x, 0.1, -29.5);
  }
  const tray = builder.cylinder(
    TRAY.radius,
    0.25,
    "#b6b09c",
    TRAY.x,
    TRAY.y / 2,
    TRAY.z,
    32,
  );
  tray.receiveShadow = true;
  tray.material = stoneFinish;
  signPost(builder, "Tide pools\nCrouch • Watch • Arrange", -18, 1.3, -25.5);
  for (let i = 0; i < 18; i++) {
    const a = (i * Math.PI * 2) / 18,
      x = -19 + Math.cos(a) * 2.35,
      z = -30 + Math.sin(a) * 1.85;
    const rim = builder.blob(
      0.26 + (i % 3) * 0.05,
      i % 2 ? "#8e9285" : "#a1a08f",
      x,
      ground(x, z) + 0.05,
      z,
      1,
    );
    rim.scale.y = 0.65;
  }
  const crabs = Array.from({ length: 4 }, (_, i) => {
    const g = builder.group();
    builder.blob(0.1, "#d67040", 0, 0.03, 0, 0, g);
    for (const side of [-1, 1]) {
      for (let leg = 0; leg < 4; leg++) {
        const limb = builder.box(
          0.12,
          0.016,
          0.016,
          "#a75432",
          side * 0.11,
          0.015,
          (leg - 1.5) * 0.04,
          g,
        );
        limb.rotation.y = side * (0.4 + leg * 0.12);
      }
      builder.blob(0.035, "#e29261", side * 0.12, 0.045, -0.09, 1, g);
      builder.blob(0.012, "#24322d", side * 0.03, 0.085, -0.05, 0, g);
    }
    g.position.set(-20 + i * 0.75, ground(-20 + i * 0.75, -29.5), -29.5);
    return g;
  });
  const crabAnchor = new THREE.Vector3(-19, ground(-19, -29) + 0.12, -29);
  interactables.push({
    kind: "object",
    id: "watch-crab",
    title: "Watch the tide-pool crabs",
    anchor: crabAnchor,
    maxDistance: 3,
    activate: () => {
      if (!crouching) {
        notice = "Crouch to watch without startling the crabs.";
        return;
      }
      emit({ kind: "observe", id: "crab", x: eye.x, z: eye.z });
      notice =
        "They came out of hiding. Try arranging shells on the stone tray.";
    },
  });
  // Camp can be reached directly from the entrance; roof really provides rain cover.
  for (const { x, z } of CANOPY_POLES)
    builder.cylinder(0.085, CANOPY.y, "#756347", x, CANOPY.y / 2, z);
  const canopyGeo = new THREE.PlaneGeometry(CANOPY.width, CANOPY.depth, 12, 8);
  canopyGeo.rotateX(-Math.PI / 2);
  const canopyVertices = canopyGeo.getAttribute("position");
  for (let i = 0; i < canopyVertices.count; i++)
    canopyVertices.setY(
      i,
      0.35 *
        Math.cos(((canopyVertices.getX(i) / (CANOPY.width / 2)) * Math.PI) / 2),
    );
  canopyGeo.computeVertexNormals();
  const canopyBase = Array.from({ length: canopyVertices.count }, (_, i) =>
    canopyVertices.getY(i),
  );
  const canopy = builder.track(
    new THREE.Mesh(
      canopyGeo,
      new THREE.MeshStandardMaterial({
        color: "#c8b289",
        roughness: 0.92,
        side: THREE.DoubleSide,
      }),
    ),
  );
  canopy.position.set(CANOPY.x, CANOPY.y, CANOPY.z);
  canopy.castShadow = true;
  for (const seat of CAMP_SEATS)
    interactables.push({
      kind: "seat",
      id: seat.id,
      title: "Sit and watch the sea",
      anchor: new THREE.Vector3(seat.x, seat.top + 0.1, seat.z),
      maxDistance: 2.5,
      activate: () => {
        emit({ kind: "seat", id: seat.id, x: eye.x, z: eye.z });
        notice = "Taking a seat…";
      },
    });
  builder.box(1.7, 0.12, 0.8, "#967b52", 23, 0.65, 17);
  const repairBoards = Array.from({ length: 5 }, (_, i) => {
    const board = builder.box(
      1.3,
      0.06,
      0.2,
      "#ad9067",
      18,
      0.2,
      18.4 + i * 0.23,
    );
    board.visible = false;
    return board;
  });
  interactables.push({
    kind: "object",
    id: "repair-shelter",
    title: "Give wood to Bruno for the shelter",
    anchor: new THREE.Vector3(23, 0.9, 17),
    maxDistance: 2.7,
    activate: () => {
      if (
        ITEM_BY_ID.get(heldItem(shared, self, Date.now() + offset) ?? "")
          ?.kind !== "wood"
      ) {
        notice = "Bring a piece of driftwood to the repair bench.";
        return;
      }
      emit({ kind: "repair", id: "bear", x: eye.x, z: eye.z });
      notice = "Bringing wood to the bench…";
    },
  });
  const fire = builder.blob(0.35, "#e9a74f", 18, 0.4, 18.4, 1);
  (fire.material as THREE.MeshStandardMaterial).emissive.set("#f29934");
  const campLight = builder.track(new THREE.PointLight("#ffbd69", 2.3, 13));
  campLight.position.set(18, 1.2, 18.4);
  signPost(builder, "Beach camp\nShelter • Sunset • Stars", 23.8, 1.4, 12, 1.6);
  const windmill = builder.group();
  windmill.position.set(20.5, 2.4, 15);
  for (let i = 0; i < 4; i++) {
    const blade = builder.box(0.14, 1.3, 0.04, "#e5bf6e", 0, 0.5, 0, windmill);
    blade.rotation.z = (i * Math.PI) / 2;
    blade.position.set(
      Math.sin((i * Math.PI) / 2) * 0.5,
      Math.cos((i * Math.PI) / 2) * 0.5,
      0,
    );
  }
  // Stars are real world-space particles, faded using the shared world clock.
  const starGeo = new THREE.BufferGeometry();
  const starPositions = [];
  for (let i = 0; i < 150; i++) {
    const a = i * 2.399963,
      r = 140,
      h = 25 + (i % 40) * 2;
    starPositions.push(Math.sin(a) * r, h, Math.cos(a) * r);
  }
  starGeo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(starPositions, 3),
  );
  const starMat = new THREE.PointsMaterial({
    color: "#eef3ff",
    size: 0.65,
    transparent: true,
    opacity: 0,
  });
  const stars = builder.track(new THREE.Points(starGeo, starMat));
  interactables.push({
    kind: "object",
    id: "watch-sky",
    title: "Watch the sky together",
    anchor: new THREE.Vector3(18, 1, 16),
    activate: () => {
      const m = worldMoment(Date.now() + offset);
      if (m.phase === "night" || m.phase === "sunset") {
        emit({
          kind: "observe",
          id: m.phase === "night" ? "stars" : "sunset",
          x: eye.x,
          z: eye.z,
        });
        notice =
          m.phase === "night"
            ? "Look up. The stars are visible from the camp."
            : "Take a seat and watch the sea turn gold.";
      } else notice = "Neighbors gather here at sunset; stars appear at night.";
    },
  });
  // Spatially distributed props provide a discovery every short walk, with no HUD arrows.
  signPost(builder, "← Dune lookout\nTide pools ↑   Camp →", -5.5, 1.3, 4, 1.6);
  let exhibitCount = 0,
    shareApp: () => void = () => {};
  const exhibitSign = signPost(
    builder,
    "No apps shared yet\nShare an app link in Talk",
    10,
    1.3,
    -13.8,
    1.6,
  );
  interactables.push({
    kind: "object",
    id: "share-app",
    title: "Share an app link in Talk",
    anchor: new THREE.Vector3(10, 1.3, -13.8),
    maxDistance: 4,
    activate: () => {
      if (exhibitCount === 0) shareApp();
      else
        notice =
          "Face a display to open it, then return here to talk about it.";
    },
  });

  // Shells, wood, leaves, stones and balls all use the same state/interaction path.
  const meshes = ITEMS.map((item) => {
    const colors = {
      stone: "#8c928b",
      shell: "#ffe3bf",
      wood: "#95724e",
      ball: "#d78568",
      leaf: "#b2af57",
    };
    const mesh = builder.blob(
      item.kind === "ball" ? 0.22 : 0.13,
      item.kind === "shell"
        ? ["#ffe3bf", "#e9bba4", "#dcd6c5", "#f2d699"][ITEMS.indexOf(item) % 4]
        : colors[item.kind],
      item.x,
      ground(item.x, item.z) + 0.1,
      item.z,
      item.kind === "stone" ? 1 : 2,
    );
    mesh.material = (mesh.material as THREE.MeshStandardMaterial).clone();
    builder.trackResource(mesh.material);
    if (item.kind === "shell") {
      mesh.geometry = mesh.geometry.clone();
      builder.trackResource(mesh.geometry);
    }
    if (item.kind === "wood") mesh.scale.set(4.6, 0.65, 1.2);
    if (item.kind === "shell") {
      const positions = mesh.geometry.getAttribute("position");
      for (let v = 0; v < positions.count; v++) {
        const angle = Math.atan2(positions.getZ(v), positions.getX(v));
        const ridge =
          1 + Math.cos(angle * (8 + (ITEMS.indexOf(item) % 3))) * 0.07;
        positions.setXYZ(
          v,
          positions.getX(v) * ridge,
          positions.getY(v),
          positions.getZ(v) * ridge,
        );
      }
      mesh.geometry.computeVertexNormals();
    }
    mesh.userData.nonOccluding = true;
    if (item.kind === "shell" || item.kind === "leaf")
      mesh.scale.set(1.3, 0.35, 0.85);
    const anchor = new THREE.Vector3(
      item.x,
      ground(item.x, item.z) + 0.13,
      item.z,
    );
    interactables.push({
      kind: "object",
      id: item.id,
      title:
        item.id === "keepsake" ? "Olive’s lost shell" : `Pick up ${item.kind}`,
      anchor,
      maxDistance: 3.2,
      activate: () => {
        const now = Date.now() + offset,
          p = itemPosition(item, shared.objects[item.id], now, shared);
        if (p.held) {
          notice = "Someone is holding this. Try another object.";
          return;
        }
        if (heldItem(shared, self, now)) {
          notice = "Place or throw what you are holding first.";
          return;
        }
        emit({ kind: "take", id: item.id, x: eye.x, z: eye.z });
        notice = `Picking up ${item.kind}…`;
      },
    });
    return mesh;
  });
  const ripples = Array.from({ length: 12 }, () => {
    const mesh = builder.track(
      new THREE.Mesh(
        new THREE.RingGeometry(0.13, 0.15, 24),
        new THREE.MeshBasicMaterial({
          color: "#f1f5dc",
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      ),
    );
    mesh.rotation.x = -Math.PI / 2;
    return { mesh, at: 0 };
  });
  const traces = Array.from({ length: 48 }, () => {
    const mesh = builder.track(
      new THREE.Mesh(
        new THREE.CircleGeometry(0.075, 8),
        new THREE.MeshBasicMaterial({
          color: "#8f8066",
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      ),
    );
    mesh.scale.y = 1.7;
    mesh.rotation.x = -Math.PI / 2;
    return { mesh, at: 0 };
  });
  let traceIndex = 0,
    rippleIndex = 0;
  const rainGeo = new THREE.BufferGeometry(),
    rainArray = new Float32Array(100 * 3);
  rainGeo.setAttribute("position", new THREE.BufferAttribute(rainArray, 3));
  const rain = builder.track(
    new THREE.Points(
      rainGeo,
      new THREE.PointsMaterial({
        color: "#b8d0df",
        size: 0.065,
        transparent: true,
        opacity: 0.65,
      }),
    ),
  );
  rain.visible = false;
  const ghost = builder.track(
    new THREE.Mesh(
      new THREE.RingGeometry(0.1, 0.16, 24),
      new THREE.MeshBasicMaterial({
        color: "#f9e8a5",
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    ),
  );
  ghost.rotation.x = -Math.PI / 2;
  ghost.visible = false;
  ghost.userData.nonOccluding = true;
  const arcArray = new Float32Array(18 * 3),
    arcGeometry = new THREE.BufferGeometry();
  arcGeometry.setAttribute("position", new THREE.BufferAttribute(arcArray, 3));
  const arc = builder.track(
    new THREE.Line(
      arcGeometry,
      new THREE.LineBasicMaterial({
        color: "#f9e8a5",
        transparent: true,
        opacity: 0.5,
      }),
    ),
  );
  arc.visible = false;
  const marks = Array.from({ length: 64 }, () => {
    const mesh = builder.track(
      new THREE.Mesh(
        new THREE.PlaneGeometry(1, 0.025),
        new THREE.MeshBasicMaterial({
          color: "#776c58",
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      ),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.userData.nonOccluding = true;
    return mesh;
  });
  const puddles = [-8, 8, 24].map((x, i) => {
    const z = 11 + i * 3;
    const mesh = builder.track(
      new THREE.Mesh(
        new THREE.CircleGeometry(0.8, 24),
        new THREE.MeshStandardMaterial({
          color: "#9fa89e",
          roughness: 0.15,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
        }),
      ),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, ground(x, z) + 0.008, z);
    mesh.scale.y = 0.55;
    mesh.visible = false;
    return mesh;
  });
  const baseScales = meshes.map((m) => m.scale.clone());
  const landedAt = new Map<string, number>();
  const placement = (id: string) => {
    const distance =
      forward.y < -0.2
        ? Math.max(
            0.45,
            Math.min(2.4, (eye.y - ground(eye.x, eye.z)) / -forward.y),
          )
        : 1.1;
    const x = Math.max(-53, Math.min(53, eye.x + forward.x * distance)),
      z = Math.max(-53, Math.min(53, eye.z + forward.z * distance));
    const now = Date.now() + offset;
    const base = ITEMS.filter((item) => item.id !== id)
      .map((item) => ({
        item,
        p: itemPosition(item, shared.objects[item.id], now, shared),
      }))
      .filter(({ item, p }) => !p.held && supportsObject(item, p, x, z))
      .sort((a, b) => b.p.y - a.p.y)[0];
    return {
      x,
      z,
      y: base
        ? base.p.y + ITEM_PHYSICS[base.item.kind].height / 2
        : objectGround(x, z),
      support: base?.item.id,
    };
  };
  const runtime: OpenAirRuntime = {
    pending(on) {
      pendingAction = on;
    },
    feedback(text) {
      notice = text;
      noticeAt = Date.now() + offset;
      previousNotice = text;
    },
    highlight(id) {
      selectedId = id;
    },
    setLighting(id) {
      lighting = id;
    },
    cancelCharge() {
      chargedAt = 0;
    },
    charge(on) {
      if (on) chargedAt = Date.now() + offset;
      else if (chargedAt) {
        runtime.useHeld(true);
        chargedAt = 0;
      }
    },
    rotateHeld() {
      heldYaw = (heldYaw + Math.PI / 8) % (Math.PI * 2);
    },
    mark() {
      const now = Date.now() + offset;
      if (now - lastMark < 700) return;
      lastMark = now;
      emit({
        kind: "mark",
        id: "sand",
        x: eye.x + forward.x * 0.5,
        z: eye.z + forward.z * 0.5,
        dx: forward.x * 1.2,
        dz: forward.z * 1.2,
      });
      notice = "Drawing in the sand…";
    },
    surface() {
      return eye.x > 20 && eye.x < 24 && eye.z < -23
        ? "wood"
        : Math.hypot(eye.x, eye.z) < 3.5 || (eye.x < -22 && eye.z > 6)
          ? "stone"
          : "sand";
    },
    supportHeight(x, z) {
      let top = -Infinity;
      for (const item of ITEMS) {
        if (item.kind !== "wood") continue;
        const saved = shared.objects[item.id];
        if (!saved || saved.owner || Math.hypot(saved.vx, saved.vz) > 0.1)
          continue;
        const p = itemPosition(item, saved, Date.now() + offset, shared);
        if (supportsObject(item, p, x, z))
          top = Math.max(top, p.y + ITEM_PHYSICS.wood.height / 2);
      }
      return top;
    },
    stopEscort() {
      for (const [id, lease] of Object.entries(shared.leases))
        if (lease?.owner === self && lease.goal)
          emit({ kind: "release", id: id as ResidentId });
      notice = "Saying goodbye…";
    },
    colliders,
    interactables,
    takeSound() {
      const value = sound;
      sound = null;
      return value;
    },
    bind(fn, share) {
      emit = fn;
      if (share) shareApp = share;
    },
    setExhibitCount(count) {
      exhibitCount = count;
      exhibitSign(
        count
          ? `${count} shared displays\nTry one • Return to talk`
          : "No apps shared yet\nShare an app link in Talk",
      );
    },
    setState(s, id, o, c) {
      if (
        id === self &&
        (s.observations[id]?.length ?? 0) >
          (shared.observations[id]?.length ?? 0)
      )
        sound = "chime";
      shared = s;
      self = id;
      offset = o;
      connected = c;
    },
    setEye(e, f, c, m) {
      eye.copy(e);
      forward.copy(f);
      crouching = c;
      moving = m;
    },
    state: () => shared,
    now: () => Date.now() + offset,
    setPeers(next) {
      peers = next;
    },
    peer(id) {
      return id === self ? eye : peers.get(id);
    },
    status() {
      const now = Date.now() + offset;
      return {
        held: heldItem(shared, self, now) ?? null,
        notice: now - noticeAt < 8000 ? notice : "",
        place: lastPlace,
        moment: worldMoment(now),
        pending: pendingAction,
        charge: chargedAt ? Math.min(1, (now - chargedAt) / 1100) : 0,
        rotation: heldYaw,
        lighting,
        hint: DISCOVERIES[(shared.observations[self] ?? []).at(-1) ?? ""]?.hint,
        companion: (() => {
          const entry = Object.entries(shared.leases).find(
            ([, lease]) =>
              lease?.owner === self && lease.goal && now - lease.at < 30000,
          );
          if (!entry || !entry[1]?.goal) return null;
          const [id, lease] = entry,
            point = peers.get(id) ?? lease,
            goal = OPEN_AIR_PLACES.find((p) => p.id === lease.goal)!;
          return {
            id: id as ResidentId,
            name: RESIDENT_NAMES[id] ?? id,
            goal: goal.name,
            phase:
              Math.hypot(point.x - goal.x, point.z - goal.z) < goal.radius
                ? ("arrived" as const)
                : Math.hypot(point.x - eye.x, point.z - eye.z) > 4
                  ? ("waiting" as const)
                  : ("walking" as const),
          };
        })(),
        memories: (shared.encounters[self] ?? [])
          .filter((e) => now >= e.at && now - e.at < 900000)
          .map((e) => encounterTitle(e.id, e.kind)),
        observations: shared.observations[self] ?? [],
        connected,
        seated: runtime.seat()?.id ?? null,
      };
    },
    useHeld(throwing) {
      const now = Date.now() + offset,
        id = heldItem(shared, self, now);
      if (!id) {
        notice =
          "Face a shell, stone, leaf, ball or piece of wood and interact to pick it up.";
        return;
      }
      if (pendingAction) return;
      const target = placement(id),
        strength = chargedAt ? Math.min(1, (now - chargedAt) / 1100) : 0.35,
        speed = 2.5 + strength * 5;
      emit({
        kind: throwing ? "throw" : "place",
        id,
        x: throwing ? eye.x + forward.x * 0.45 : target.x,
        z: throwing ? eye.z + forward.z * 0.45 : target.z,
        y: throwing ? eye.y - 0.35 : target.y,
        vx: throwing ? forward.x * speed : 0,
        vz: throwing ? forward.z * speed : 0,
        vy: throwing ? forward.y * speed + 1.2 : 0,
        yaw: heldYaw,
        ...(throwing || !target.support ? {} : { support: target.support }),
      });
      notice = throwing ? "Throwing…" : "Placing…";
    },
    seat() {
      const now = Date.now() + offset;
      return (
        CAMP_SEATS.find((s) => {
          const lease = shared.seats[s.id];
          return (
            lease?.owner === self &&
            now - lease.at < 30000 &&
            lease.at !== ignoredSeatAt
          );
        }) ?? null
      );
    },
    stand() {
      const seat = runtime.seat();
      if (seat) {
        ignoredSeatAt = shared.seats[seat.id].at;
        emit({ kind: "stand", id: seat.id });
      }
    },
    deliver() {
      emit({ kind: "deliver", id: "owl", x: eye.x, z: eye.z });
      notice = "Returning Olive’s shell…";
    },
    escort(id, goal) {
      const lease = activeLease(shared, id, Date.now() + offset);
      if (lease && lease.owner !== self) {
        notice = "This neighbor is helping someone else. Try another neighbor.";
        return;
      }
      if (!lease) {
        notice = "Talk to this neighbor first, then invite them.";
        return;
      }
      emit({ kind: "lease", id, x: lease.x, z: lease.z, goal });
      notice = "Inviting your neighbor…";
    },
    update(_dt) {
      const now = Date.now() + offset,
        moment = worldMoment(now),
        water = SEA_LEVEL + moment.tide;
      if (notice !== previousNotice) {
        previousNotice = notice;
        noticeAt = now;
      }
      tideMarks.forEach((mark) => {
        mark.position.y = water + 0.008;
        mark.visible = mark.position.z < -30;
      });
      buoys.forEach((b) => {
        b.position.z =
          shoreZ(b.position.x) -
          (0.68 - moment.tide) / 0.065 / landward(b.position.x)[1];
        b.position.y = water + Math.sin(now / 1200 + b.position.x) * 0.035;
      });
      const place = OPEN_AIR_PLACES.find(
        (p) => Math.hypot(eye.x - p.x, eye.z - p.z) < p.radius,
      );
      if (place && lastPlace !== place.name) {
        notice = `${place.name}. ${place.description}`;
        if (connected && !(shared.observations[self] ?? []).includes(place.id))
          emit({ kind: "observe", id: place.id, x: eye.x, z: eye.z });
      }
      lastPlace = place?.name ?? "";
      const wet = terrainHeight(eye.x, eye.z) < water;
      const held = heldItem(shared, self, now);
      ghost.visible = !!held;
      arc.visible = !!held && chargedAt > 0;
      if (held) {
        const target = placement(held);
        ghost.position.set(target.x, target.y + 0.02, target.z);
        ghost.scale.set(ITEM_BY_ID.get(held)?.kind === "wood" ? 3 : 1, 1, 1);
        ghost.rotation.z = heldYaw;
        if (arc.visible) {
          const speed = 2.5 + Math.min(1, (now - chargedAt) / 1100) * 5;
          for (let i = 0; i < 18; i++) {
            const t = i * 0.08;
            arcArray[i * 3] = eye.x + forward.x * (0.45 + speed * t);
            arcArray[i * 3 + 2] = eye.z + forward.z * (0.45 + speed * t);
            arcArray[i * 3 + 1] = Math.max(
              objectGround(arcArray[i * 3], arcArray[i * 3 + 2]) + 0.05,
              eye.y - 0.35 + (forward.y * speed + 1.2) * t - 4.9 * t * t,
            );
          }
          arcGeometry.getAttribute("position").needsUpdate = true;
        }
      }
      const movementSpeed = _dt > 0 ? eye.distanceTo(lastEye) / _dt : 0;
      lastEye.copy(eye);
      marks.forEach((mesh, i) => {
        const mark = shared.marks?.[i];
        if (!mark) {
          mesh.visible = false;
          return;
        }
        const age = now - mark.at,
          wetMark = terrainHeight(mark.x, mark.z) < water + 0.05;
        mesh.visible = age < 45000 && !wetMark;
        mesh.position.set(
          mark.x + mark.dx / 2,
          ground(mark.x, mark.z) + 0.014,
          mark.z + mark.dz / 2,
        );
        mesh.scale.x = Math.hypot(mark.dx, mark.dz);
        mesh.rotation.z = -Math.atan2(mark.dz, mark.dx);
        mesh.material.opacity = 0.35 * (1 - age / 45000);
      });
      puddles.forEach((mesh) => {
        mesh.visible = moment.weather === "rain";
      });
      const repairCount = Object.keys(shared.repairs ?? {}).length;
      repairBoards.forEach((board, i) => {
        board.visible = i < repairCount;
      });
      for (let v = 0; v < canopyVertices.count; v++)
        canopyVertices.setY(
          v,
          canopyBase[v] -
            (repairCount >= 2
              ? 0
              : 0.17 * Math.max(0, 1 - Math.abs(canopyVertices.getX(v)) / 4)),
        );
      canopyVertices.needsUpdate = true;
      if (moving && now - lastTrace > 320 && !reducedMotion) {
        lastTrace = now;
        const t = wet
          ? ripples[rippleIndex++ % ripples.length]
          : traces[traceIndex++ % traces.length];
        t.at = now;
        t.mesh.position.set(
          eye.x,
          wet ? water + 0.02 : ground(eye.x, eye.z) + 0.012,
          eye.z,
        );
        t.mesh.rotation.z = traceIndex % 2 ? 0.13 : -0.13;
      }
      if (wet && !lastWet)
        notice =
          "The water slows your steps. The buoys mark the safe wading limit.";
      if (moving && SEA_LEVEL + moment.tide - terrainHeight(eye.x, eye.z) > 0.6)
        notice =
          "The current is deep here. Follow the exposed rocks or return toward the beach.";
      lastWet = wet;
      for (const t of traces) {
        const age = (now - t.at) / 1000;
        const washed = t.mesh.position.y < water + 0.08;
        t.mesh.material.opacity =
          age < 25 && !washed ? 0.28 * (1 - age / 25) : 0;
      }
      for (const r of ripples) {
        const age = (now - r.at) / 1000;
        r.mesh.scale.setScalar(1 + age * 3);
        r.mesh.material.opacity = age < 1.5 ? 0.5 * (1 - age / 1.5) : 0;
      }
      ITEMS.forEach((item, i) => {
        const saved = shared.objects[item.id],
          p = itemPosition(item, saved, now, shared);
        const own = p.held && saved?.owner === self;
        const holder =
          p.held && saved?.owner ? peers.get(saved.owner) : undefined;
        meshes[i].visible = !p.held || own || !!holder || !!p.carrier;
        const material = meshes[i].material as THREE.MeshStandardMaterial;
        material.emissive.set(item.id === selectedId ? "#76674a" : "#000000");
        meshes[i].rotation.y = own ? heldYaw : p.yaw;
        meshes[i].rotation.z = p.roll ?? 0;
        if (!p.held && item.kind === "shell" && p.y < water)
          meshes[i].visible =
            Math.sin(now / 1200) * 0.035 + water < p.y + 0.055;
        if (holder && !own) {
          meshes[i].position.set(
            holder.x - Math.sin(holder.yaw ?? 0) * 0.4,
            (holder.y ?? ground(holder.x, holder.z) + 1.65) - 0.55,
            holder.z - Math.cos(holder.yaw ?? 0) * 0.4,
          );
        }
        if (own) {
          meshes[i].position.copy(eye).addScaledVector(forward, 0.8);
          meshes[i].position.y -= 0.55;
          meshes[i].scale
            .copy(baseScales[i])
            .multiplyScalar(item.kind === "ball" ? 1 : 1.3);
        } else if (!holder) {
          meshes[i].position.set(p.x, p.y, p.z);
          meshes[i].scale.copy(baseScales[i]);
        }
        const anchor = interactables.find((t) => t.id === item.id)!.anchor;
        anchor.set(p.x, p.held || !meshes[i].visible ? -100 : p.y + 0.05, p.z);
        if (
          connected &&
          moving &&
          item.kind === "ball" &&
          !p.held &&
          now - lastPush > 700 &&
          Math.hypot(eye.x - p.x, eye.z - p.z) < 0.65
        ) {
          lastPush = now;
          emit({
            kind: "push",
            id: item.id,
            x: eye.x,
            z: eye.z,
            vx: forward.x * 2.4,
            vz: forward.z * 2.4,
          });
        }
        if (
          saved &&
          !saved.owner &&
          now - saved.at >= 800 &&
          now - saved.at < 2400 &&
          landedAt.get(item.id) !== saved.at
        ) {
          landedAt.set(item.id, saved.at);
          if (ground(p.x, p.z) < water) {
            if (Math.hypot(eye.x - p.x, eye.z - p.z) < 10) sound = "splash";
            const r = ripples[rippleIndex++ % ripples.length];
            r.at = now;
            r.mesh.position.set(p.x, water + 0.03, p.z);
          }
        }
      });
      const visiblePhase =
        lighting === "magic-hour" ? "sunset" : (lighting ?? moment.phase);
      if (visiblePhase === "sunset" || visiblePhase === "night") {
        campLight.intensity = lighting ? 3 : 0.4 + 2.6 * nightVisibility(now);
        fire.visible = true;
      } else {
        campLight.intensity = 0.4;
        fire.visible = false;
      }
      starMat.opacity =
        0.85 *
        (lighting ? (visiblePhase === "night" ? 1 : 0) : nightVisibility(now));
      stars.visible = starMat.opacity > 0.01;
      sail.rotation.y = Math.atan2(moment.windX, moment.windZ) + Math.PI / 2;
      sail.rotation.z = moment.windX * 0.1;
      if (!reducedMotion) {
        windmill.rotation.z += _dt * moment.wind * 2.4;
        sail.rotation.z =
          moment.windX * 0.1 + Math.sin(now / 1200) * moment.wind * 0.08;
      }
      const covered = sheltered(eye.x, eye.y, eye.z, repairCount);
      rain.visible = moment.weather === "rain" && !covered && !reducedMotion;
      if (rain.visible) {
        for (let i = 0; i < 100; i++) {
          rainArray[i * 3] = eye.x + Math.sin(i * 7.12) * 8;
          rainArray[i * 3 + 1] =
            ((now / 110 + i * 0.71) % 8) + ground(eye.x, eye.z);
          rainArray[i * 3 + 2] = eye.z + Math.cos(i * 3.45) * 8;
        }
        (
          rainGeo.getAttribute("position") as THREE.BufferAttribute
        ).needsUpdate = true;
      }
      crabs.forEach((crab, i) => {
        const near =
          Math.hypot(eye.x - crab.position.x, eye.z - crab.position.z) < 3;
        const retreat = near && (!crouching || movementSpeed > 2) ? 1 : 0;
        const previous = Number(crab.userData.retreat ?? 0),
          amount = previous + (retreat - previous) * Math.min(1, _dt * 5);
        crab.userData.retreat = amount;
        crab.visible = amount < 0.98;
        crab.position.x =
          -20 +
          i * 0.75 +
          amount * 0.3 +
          (reducedMotion ? 0 : Math.sin(now / 1700 + i) * 0.12);
        crab.position.y =
          ground(crab.position.x, crab.position.z) - amount * 0.12;
        crab.children.forEach((leg, j) => {
          if (j > 0 && j < 9 && !reducedMotion)
            leg.rotation.z = Math.sin(now / 100 + j) * 0.18 * (1 - amount);
        });
      });
      if (
        now - lastObserved > 15000 &&
        eye.y > 2.05 &&
        Math.hypot(eye.x, eye.z) < 4
      ) {
        lastObserved = now;
        if (
          connected &&
          !(shared.observations[self] ?? []).includes("fountain")
        )
          emit({ kind: "observe", id: "fountain", x: eye.x, z: eye.z });
      }
      if (moment.tide < -0.1 && eye.z < -24 && eye.x > 12 && eye.x < 25)
        notice =
          "Low tide: the rock shortcut is exposed. The beach is always a safe way back.";
    },
    dispose() {},
  };
  return runtime;
}
