/**
 * The part that does not change when the World does.
 *
 * Renderer, camera, input, movement, the render loop, and the mounting and
 * unmounting of a World. Everything here is true in all eight places; anything
 * that differs between them belongs in a `WorldDefinition`.
 *
 * The engine owns exactly one `WorldRuntime` at a time. Mounting the next one
 * disposes the current one first — never both in the scene, not even for a
 * frame — so eight Worlds cost what one costs, which is the difference between
 * this running on a phone and not.
 */
import * as THREE from "three";

import { resolveMovement, type Collider } from "./collision";
import { createWorldBuilder, type WorldBuilder } from "./primitives";
import {
  CROUCH_EYE_HEIGHT,
  CROUCH_SPEED,
  EYE_HEIGHT,
  clampPitch,
  movementVector,
  stepVertical,
  SendCadence,
  WORLD_RADIUS,
  type MovementState,
} from "./worldMath";
import type { Pose, WorldDefinition, WorldRuntime } from "./types";

export interface EngineFrame {
  now: number;
  dt: number;
  movement: MovementState;
  /** Locomotion posture. Seats override this in `world.ts`; the engine reports stand/crouch. */
  pose: Pose;
  forward: THREE.Vector3;
}

export interface EngineOptions {
  host: HTMLDivElement;
  onPointerLockChange(locked: boolean): void;
  onRequestChat(): void;
  onInteract(): void;
  onReaction(index: number): void;
  onError(message: string): void;
}

export interface Engine {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly reducedMotion: boolean;
  readonly labelHost: HTMLElement;
  /** Null between `dispose()` of one World and `mount()` of the next. */
  readonly world: WorldRuntime | null;
  mount(definition: WorldDefinition): void;
  onFrame(handler: (frame: EngineFrame) => void): void;
  requestPointerLock(): void;
  setPaused(paused: boolean): void;
  setJoystick(x: number, y: number): void;
  /** Touch jump button (keyboard uses Space). Ignored while paused. */
  jump(): void;
  /** Touch crouch toggle. ORed with the held C / Control keys. */
  setCrouching(crouching: boolean): void;
  /** Screen position for a world point, or null when off-screen/behind. */
  project(point: THREE.Vector3): { left: number; top: number; distance: number } | null;
  cadenceDue(now: number): boolean;
  dispose(): void;
}

const REACTION_KEYS = ["Digit1", "Digit2", "Digit3", "Digit4"];

export function createEngine(options: EngineOptions): Engine {
  const { host } = options;
  const width = host.clientWidth || 1;
  const height = host.clientHeight || 1;

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
  } catch (cause) {
    throw new Error("webgl_unavailable", { cause });
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
  renderer.setSize(width, height);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(64, width / height, 0.05, 110);
  camera.rotation.order = "YXZ";

  const reducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Lighting belongs to the engine, not to a World: every World wants a key
  // and a fill, and rebuilding two lights per switch would mean recompiling
  // every material in the new scene. Worlds re-colour them instead.
  const hemisphere = new THREE.HemisphereLight("#e8f8ff", "#839d63", 2.5);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight("#fff4da", 3);
  sun.position.set(-12, 22, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.bias = -0.0003;
  scene.add(sun);

  const keys = new Set<string>();
  const joystick = { x: 0, y: 0 };
  const cadence = new SendCadence();
  const teardown: (() => void)[] = [];

  let yaw = 0;
  let pitch = -0.03;
  let paused = false;
  let locked = false;
  let raf = 0;
  let lastFrame = performance.now();
  let contextLost = false;
  let frameHandler: ((frame: EngineFrame) => void) | null = null;
  // Vertical locomotion. `mobileCrouch` is the touch toggle; keyboard crouch
  // is the held C / Control keys in `keys`. Either crouches.
  let vy = 0;
  let grounded = true;
  let jumpRequested = false;
  let mobileCrouch = false;

  let world: WorldRuntime | null = null;
  let worldRoot: THREE.Group | null = null;
  let worldBuilder: WorldBuilder | null = null;
  let colliders: readonly Collider[] = [];
  let groundY: ((x: number, z: number) => number) | null = null;

  const on = (
    element: EventTarget,
    type: string,
    handler: EventListenerOrEventListenerObject,
    listenerOptions?: AddEventListenerOptions,
  ) => {
    element.addEventListener(type, handler, listenerOptions);
    teardown.push(() =>
      element.removeEventListener(type, handler, listenerOptions),
    );
  };

  // ---- input ---------------------------------------------------------------

  on(document, "pointerlockchange", () => {
    locked = document.pointerLockElement === renderer.domElement;
    // Keys held when the lock breaks would otherwise stick down forever.
    keys.clear();
    jumpRequested = false;
    options.onPointerLockChange(locked);
  });

  on(document, "mousemove", (event) => {
    if (!locked || paused) return;
    const mouse = event as MouseEvent;
    yaw -= mouse.movementX * 0.0022;
    pitch = clampPitch(pitch - mouse.movementY * 0.0022);
  });

  on(window, "keydown", (event) => {
    const keyboard = event as KeyboardEvent;
    const tag = (keyboard.target as HTMLElement | null)?.tagName;
    if (paused || tag === "INPUT" || tag === "TEXTAREA") return;
    if (keyboard.key === "Enter") {
      keyboard.preventDefault();
      keys.clear();
      options.onRequestChat();
      return;
    }
    if (keyboard.code === "KeyE") {
      options.onInteract();
      return;
    }
    if (keyboard.code === "Space") {
      // Jump is edge-triggered; holding Space must not bunny-hop from repeat.
      if (locked && !keyboard.repeat) {
        keyboard.preventDefault();
        jumpRequested = true;
      }
      return;
    }
    const reactionIndex = REACTION_KEYS.indexOf(keyboard.code);
    if (reactionIndex >= 0) {
      options.onReaction(reactionIndex);
      return;
    }
    if (
      locked &&
      ["KeyW", "KeyA", "KeyS", "KeyD", "KeyC", "ControlLeft"].includes(
        keyboard.code,
      )
    ) {
      if (keyboard.code !== "ControlLeft") keyboard.preventDefault();
      keys.add(keyboard.code);
    }
  });

  on(window, "keyup", (event) => keys.delete((event as KeyboardEvent).code));
  on(window, "blur", () => {
    keys.clear();
    jumpRequested = false;
    joystick.x = 0;
    joystick.y = 0;
  });

  on(renderer.domElement, "click", () => {
    if (!paused && !locked) engine.requestPointerLock();
  });

  // Touch look. Only the right side drags the view, so it cannot fight the
  // joystick living on the left.
  let dragPointer = -1;
  let dragX = 0;
  let dragY = 0;
  on(renderer.domElement, "pointerdown", (event) => {
    const pointer = event as PointerEvent;
    if (pointer.pointerType === "mouse" || paused) return;
    if (pointer.clientX < window.innerWidth * 0.4) return;
    dragPointer = pointer.pointerId;
    dragX = pointer.clientX;
    dragY = pointer.clientY;
    renderer.domElement.setPointerCapture(pointer.pointerId);
  });
  on(renderer.domElement, "pointermove", (event) => {
    const pointer = event as PointerEvent;
    if (pointer.pointerId !== dragPointer || paused) return;
    yaw -= (pointer.clientX - dragX) * 0.005;
    pitch = clampPitch(pitch - (pointer.clientY - dragY) * 0.005);
    dragX = pointer.clientX;
    dragY = pointer.clientY;
  });
  const endDrag = () => {
    dragPointer = -1;
  };
  on(renderer.domElement, "pointerup", endDrag);
  on(renderer.domElement, "pointercancel", endDrag);

  on(window, "resize", () => {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });

  // A lost context otherwise leaves a frozen canvas with no explanation.
  on(renderer.domElement, "webglcontextlost", (event) => {
    event.preventDefault();
    contextLost = true;
    options.onError("3D表示が中断されました。ページを再読み込みしてください。");
  });
  on(renderer.domElement, "webglcontextrestored", () => {
    contextLost = false;
  });

  // ---- frame ---------------------------------------------------------------

  const forward = new THREE.Vector3();
  const projected = new THREE.Vector3();

  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    if (contextLost) return;
    const dt = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;

    let right = 0;
    let ahead = 0;
    if (!paused) {
      right = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0) + joystick.x;
      ahead = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0) + joystick.y;
    }
    const crouching =
      keys.has("KeyC") || keys.has("ControlLeft") || mobileCrouch;
    const speed = crouching ? CROUCH_SPEED : undefined;
    const { vx, vz, magnitude } = movementVector(
      { right, forward: ahead },
      yaw,
      dt,
      speed,
    );
    const moved = resolveMovement(
      { x: camera.position.x, z: camera.position.z },
      { vx, vz },
      colliders,
      undefined,
      WORLD_RADIUS,
    );
    camera.position.x = moved.x;
    camera.position.z = moved.z;
    // Vertical: stick to small terrain changes, fall off edges, arc on jump.
    const groundEye =
      (groundY ? groundY(moved.x, moved.z) : 0) +
      (crouching ? CROUCH_EYE_HEIGHT : EYE_HEIGHT);
    const vertical = stepVertical(
      { y: camera.position.y, vy, grounded },
      dt,
      groundEye,
      jumpRequested && !paused,
    );
    jumpRequested = false;
    vy = vertical.vy;
    grounded = vertical.grounded;
    camera.position.y = vertical.y;
    camera.rotation.set(pitch, yaw, 0, "YXZ");
    camera.getWorldDirection(forward);

    world?.update?.(dt, now);

    const pose: Pose = crouching ? "crouch" : "stand";
    frameHandler?.({
      now,
      dt,
      movement: !grounded ? "jump" : magnitude > 0.05 ? "walk" : "idle",
      pose,
      forward,
    });

    renderer.render(scene, camera);
  }

  function unmountWorld(): void {
    world?.dispose();
    worldBuilder?.dispose();
    if (worldRoot) scene.remove(worldRoot);
    world = null;
    worldRoot = null;
    worldBuilder = null;
    colliders = [];
    groundY = null;
  }

  const engine: Engine = {
    scene,
    camera,
    reducedMotion,
    labelHost: host,

    get world() {
      return world;
    },

    mount(definition) {
      // Dispose FIRST. Building the next World before releasing the current
      // one would briefly hold two full scenes, which is exactly the spike a
      // phone cannot absorb.
      unmountWorld();

      scene.background = new THREE.Color(definition.environment.background);
      scene.fog = new THREE.Fog(
        definition.environment.fog,
        definition.environment.fogNear,
        definition.environment.fogFar,
      );

      const root = new THREE.Group();
      root.name = `world:${definition.id}`;
      scene.add(root);
      const builder = createWorldBuilder(root);
      worldRoot = root;
      worldBuilder = builder;

      const runtime = definition.build({
        root,
        builder,
        labelHost: host,
        reducedMotion,
      });
      world = runtime;
      colliders = runtime.colliders;
      groundY = runtime.groundY ?? null;

      camera.position.set(
        definition.spawn.x,
        (runtime.groundY?.(definition.spawn.x, definition.spawn.z) ?? definition.spawn.y) +
          EYE_HEIGHT,
        definition.spawn.z,
      );
      yaw = definition.spawn.yaw;
      pitch = -0.03;
      // A World change is a teleport: land standing, with no held keys or
      // queued jump surviving into the new place.
      vy = 0;
      grounded = true;
      jumpRequested = false;
      mobileCrouch = false;
      keys.clear();
      // A World change is a teleport; the next transform must go out
      // immediately rather than waiting out the cadence, or peers see the
      // arrival up to 83ms late in the wrong place.
      cadence.reset();
    },

    onFrame(handler) {
      frameHandler = handler;
    },

    requestPointerLock() {
      // Touch devices have no pointer to lock; drag-look is the equivalent.
      if (window.matchMedia?.("(pointer: coarse)").matches) return;
      try {
        const result = renderer.domElement.requestPointerLock() as
          | Promise<void>
          | undefined;
        result?.catch?.(() =>
          options.onError(
            "視点操作を開始するには、画面をもう一度クリックしてください。",
          ),
        );
      } catch {
        options.onError("このブラウザではマウス固定を利用できません。");
      }
    },

    setPaused(next) {
      paused = next;
      keys.clear();
      jumpRequested = false;
      joystick.x = 0;
      joystick.y = 0;
    },

    setJoystick(x, y) {
      joystick.x = x;
      joystick.y = y;
    },

    jump() {
      if (!paused) jumpRequested = true;
    },

    setCrouching(crouching) {
      mobileCrouch = crouching;
    },

    project(point) {
      projected.copy(point);
      const dx = projected.x - camera.position.x;
      const dy = projected.y - camera.position.y;
      const dz = projected.z - camera.position.z;
      const distance = Math.hypot(dx, dy, dz);
      const inFront = dx * forward.x + dy * forward.y + dz * forward.z > 0;
      projected.project(camera);
      const visible =
        inFront &&
        projected.z < 1 &&
        Math.abs(projected.x) < 1.2 &&
        Math.abs(projected.y) < 1.2;
      if (!visible) return null;
      return {
        left: (projected.x * 0.5 + 0.5) * (host.clientWidth || 1),
        top: (-projected.y * 0.5 + 0.5) * (host.clientHeight || 1),
        distance,
      };
    },

    cadenceDue(now) {
      return cadence.due(now);
    },

    dispose() {
      cancelAnimationFrame(raf);
      teardown.forEach((off) => off());
      unmountWorld();
      hemisphere.dispose();
      sun.dispose();
      sun.shadow.map?.dispose();
      renderer.dispose();
      host.replaceChildren();
    },
  };

  raf = requestAnimationFrame(frame);
  return engine;
}
