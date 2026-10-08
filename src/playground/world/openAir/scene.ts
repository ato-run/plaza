import * as THREE from "three";
import type { WorldBuilder } from "../primitives";
import type { Collider } from "../collision";
import { circle } from "../collision";
import type { Interactable } from "../types";
import { terrainHeight, SEA_LEVEL, shoreZ, landward } from "../beach/coast";
import {
  ITEMS,
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
  TRAY,
  landmarkGround,
  CAMP_SEATS,
  explorationColliders,
} from "./layout";
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
  seat(): (typeof CAMP_SEATS)[number] | null;
  stand(): void;
  deliver(): void;
  escort(id: ResidentId, goal: "pools" | "camp" | "pier" | "lookout"): void;
  state(): OpenAirState;
  now(): number;
  setPeers(peers: ReadonlyMap<string, { x: number; z: number }>): void;
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
        side: THREE.DoubleSide,
      }),
    ),
  );
  mesh.position.set(x, y, z);
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
  let peers: ReadonlyMap<string, { x: number; z: number }> = new Map();
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
  // Broad steps make a walking route; the outer rocks provide the jumping route.
  for (const step of OVERLOOK_STEPS) {
    builder.box(
      step.width,
      step.top + 0.25,
      step.depth,
      "#a99d86",
      step.x,
      (step.top - 0.25) / 2,
      step.z,
    );
  }
  builder.box(2.1, 3.31, 4, "#a99d86", -35.75, (3.06 - 0.25) / 2, 10.5);
  const top = OVERLOOK_STEPS[OVERLOOK_STEPS.length - 1];
  signPost(
    builder,
    "Dune lookout\nPools ↗   Pier →",
    top.x,
    top.top + 1.2,
    top.z - 1.6,
  );
  for (const rock of HOP_ROCKS) {
    const m = builder.blob(
      rock.r,
      "#938e7c",
      rock.x,
      rock.top - rock.r * 0.65,
      rock.z,
      1,
    );
    m.scale.y = 0.7;
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
      new THREE.TorusGeometry(2.2, 0.3, 8, 32, Math.PI),
      builder.material("#968d7c", { roughness: 0.93 }),
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
  signPost(builder, "Tide pools\nCrouch • Watch • Arrange", -18, 1.3, -25.5);
  const pool = builder.track(
    new THREE.Mesh(
      new THREE.CircleGeometry(2.1, 48),
      new THREE.MeshStandardMaterial({
        color: "#59aca6",
        transparent: true,
        opacity: 0.65,
        roughness: 0.15,
      }),
    ),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(-19, ground(-19, -30) + 0.04, -30);
  const crabs = Array.from({ length: 4 }, (_, i) => {
    const g = builder.group();
    builder.blob(0.1, "#d67040", 0, 0.03, 0, 0, g);
    for (const side of [-1, 1])
      builder.box(0.2, 0.025, 0.03, "#a75432", side * 0.12, 0.01, 0, g);
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
  for (const x of [14.8, 21.2])
    for (const z of [13, 17]) {
      builder.cylinder(0.085, 2.7, "#756347", x, 1.35, z);
    }
  const canopyGeo = new THREE.PlaneGeometry(6.8, 5, 8, 6);
  canopyGeo.rotateX(-Math.PI / 2);
  const canopyVertices = canopyGeo.getAttribute("position");
  for (let i = 0; i < canopyVertices.count; i++)
    canopyVertices.setY(
      i,
      0.35 * Math.cos(((canopyVertices.getX(i) / 3.4) * Math.PI) / 2),
    );
  canopyGeo.computeVertexNormals();
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
  canopy.position.set(18, 2.65, 15);
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
  const fire = builder.blob(0.35, "#e9a74f", 18, 0.4, 15, 1);
  (fire.material as THREE.MeshStandardMaterial).emissive.set("#f29934");
  const campLight = builder.track(new THREE.PointLight("#ffbd69", 2.3, 13));
  campLight.position.set(18, 1.2, 15);
  signPost(builder, "Beach camp\nShelter • Sunset • Stars", 18, 1.4, 12);
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
    0,
    1.5,
    -13.8,
    3.2,
  );
  interactables.push({
    kind: "object",
    id: "share-app",
    title: "Share an app link in Talk",
    anchor: new THREE.Vector3(0, 1.5, -13.8),
    maxDistance: 4,
    activate: () => {
      if (exhibitCount === 0) shareApp();
      else
        notice =
          "Face a display to open it, then return here to talk about it.";
    },
  });

  for (let i = 0; i < 17; i++) {
    const x = -3 - i * 0.85,
      z = 8 - i * 2;
    builder.blob(0.08, "#f4e7c8", x, ground(x, z) + 0.03, z, 0);
  }
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
      colors[item.kind],
      item.x,
      ground(item.x, item.z) + 0.1,
      item.z,
      item.kind === "stone" ? 1 : 2,
    );
    if (item.kind === "wood") mesh.scale.set(2.4, 0.55, 0.65);
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
          p = itemPosition(item, shared.objects[item.id], now);
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
  const baseScales = meshes.map((m) => m.scale.clone());
  const landedAt = new Map<string, number>();
  const runtime: OpenAirRuntime = {
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
        memories: (shared.encounters[self] ?? [])
          .filter((e) => now >= e.at && now - e.at < 900000)
          .map((e) => `${e.id}: ${e.kind}`),
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
      const x = Math.max(-53, Math.min(53, eye.x + forward.x * 1.1)),
        z = Math.max(-53, Math.min(53, eye.z + forward.z * 1.1));
      emit({
        kind: throwing ? "throw" : "place",
        id,
        x,
        z,
        vx: forward.x * 6,
        vz: forward.z * 6,
      });
      notice = throwing
        ? "Thrown. Watch where it lands."
        : "Placed. Try making an arrangement.";
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
      notice = "Walk with your neighbor. They will wait if you fall behind.";
    },
    update(_dt) {
      const now = Date.now() + offset,
        moment = worldMoment(now),
        water = SEA_LEVEL + moment.tide;
      if (notice !== previousNotice) {
        previousNotice = notice;
        noticeAt = now;
      }
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
      }
      lastPlace = place?.name ?? "";
      const wet = terrainHeight(eye.x, eye.z) < water;
      pool.position.y = water + 0.01;
      pool.visible = terrainHeight(-19, -30) < water;
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
          p = itemPosition(item, saved, now);
        const own = p.held && saved?.owner === self;
        meshes[i].visible = !p.held || own;
        if (own) {
          meshes[i].position.copy(eye).addScaledVector(forward, 0.8);
          meshes[i].position.y -= 0.55;
          meshes[i].scale
            .copy(baseScales[i])
            .multiplyScalar(item.kind === "ball" ? 1 : 1.3);
        } else {
          meshes[i].position.set(p.x, p.y, p.z);
          meshes[i].scale.copy(baseScales[i]);
        }
        const anchor = interactables.find((t) => t.id === item.id)!.anchor;
        anchor.set(p.x, p.held ? -100 : p.y + 0.05, p.z);
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
      if (moment.phase === "sunset" || moment.phase === "night") {
        campLight.intensity = 3;
        fire.visible = true;
      } else {
        campLight.intensity = 0.4;
        fire.visible = false;
      }
      starMat.opacity = moment.phase === "night" ? 0.85 : 0;
      stars.visible = moment.phase === "night";
      if (!reducedMotion) {
        windmill.rotation.z = (now / 1000) % (Math.PI * 2);
        sail.rotation.z = Math.sin(now / 1200) * moment.wind * 0.1;
      }
      const covered =
        eye.x > 14.6 && eye.x < 21.4 && eye.z > 12.5 && eye.z < 17.5;
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
        crab.visible = !near || crouching;
        crab.position.x =
          -20 + i * 0.75 + (reducedMotion ? 0 : Math.sin(now / 1700 + i) * 0.2);
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
