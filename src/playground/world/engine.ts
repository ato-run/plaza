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

import { blockingColliders, resolveMovement, type Collider } from "./collision";
import { createWorldBuilder, type WorldBuilder } from "./primitives";
import { createEnvironment } from "./rendering/environment";
import {
  detectQuality,
  PixelRatioController,
  QUALITY_PROFILES,
  type QualityProfile,
} from "./rendering/quality";
import {
  CROUCH_EYE_HEIGHT,
  CROUCH_SPEED,
  EYE_HEIGHT,
  WALK_SPEED,
  clampPitch,
  movementVector,
  stepVertical,
  SendCadence,
  WORLD_RADIUS,
  type MovementState,
} from "./worldMath";
import type { Pose, WorldDefinition, WorldRuntime } from "./types";

export type LookMode = "lock" | "drag";

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
  /**
   * The view was engaged or released. `mode` says how the view is steered:
   * a locked pointer, or — where the embedding frame forbids pointer lock
   * (a sandboxed iframe without `allow-pointer-lock`) — dragging.
   */
  onPointerLockChange(engaged: boolean, mode: LookMode): void;
  onRequestChat(): void;
  onRequestMenu?(): void;
  onInteract(): void;
  onReaction(index: number): void;
  onError(message: string): void;
}

export interface Engine {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly reducedMotion: boolean;
  readonly quality: QualityProfile;
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
  /**
   * Light the place as this time of day (an id from the World's
   * `timesOfDay`); kept across World switches, ignored by Worlds without it.
   */
  setTimeOfDay(id: string | null): void;
  /** Touch crouch toggle. ORed with the held C / Control keys. */
  setCrouching(crouching: boolean): void;
  /** Screen position for a world point, or null when off-screen/behind. */
  project(point: THREE.Vector3): { left: number; top: number; distance: number } | null;
  cadenceDue(now: number): boolean;
  dispose(): void;
}

const REACTION_KEYS = ["Digit1", "Digit2", "Digit3", "Digit4"];
const NO_COLLIDERS: readonly Collider[] = [];

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
  // `?quality=low|high` pins the tier in dev builds, for side-by-side checks.
  const forcedQuality = import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get("quality")
    : null;
  const quality =
    QUALITY_PROFILES[
      forcedQuality === "low" || forcedQuality === "high"
        ? forcedQuality
        : detectQuality({
            coarsePointer: window.matchMedia?.("(pointer: coarse)").matches ?? false,
            shortSide: Math.min(window.screen?.width ?? width, window.screen?.height ?? height),
            cores: navigator.hardwareConcurrency || undefined,
            memoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
          })
    ];
  const pixelRatio = new PixelRatioController(quality, window.devicePixelRatio || 1);
  renderer.setPixelRatio(pixelRatio.current);
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
  // Shadow texels go to the place people stand and talk; scenery beyond the
  // walk limit is lit but casts nothing worth a bigger map.
  sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 140;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);
  const environment = createEnvironment(renderer, scene, camera, sun, hemisphere);

  const keys = new Set<string>();
  let dragPointer = -1;
  let dragX = 0;
  let dragY = 0;
  const joystick = { x: 0, y: 0 };
  const cadence = new SendCadence();
  const teardown: (() => void)[] = [];

  let yaw = 0;
  let pitch = -0.03;
  let paused = false;
  let locked = false;
  // Engaged without a pointer lock: keys move, dragging looks. Entered when
  // the lock is refused, and from then on used directly for this page.
  let dragLook = false;
  let lockUnavailable = false;
  const engaged = () => locked || dragLook;
  const enterDragLook = () => {
    lockUnavailable = true;
    if (dragLook || locked) return;
    dragLook = true;
    keys.clear();
    jumpRequested = false;
    options.onPointerLockChange(true, "drag");
  };
  const leaveDragLook = () => {
    if (!dragLook) return;
    dragLook = false;
    dragPointer = -1;
    keys.clear();
    jumpRequested = false;
    options.onPointerLockChange(false, "drag");
  };
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

  /** Dev harness only: a pinned World clock for same-frame comparisons. */
  let devClock: number | null = null;
  let mountedDefinition: WorldDefinition | null = null;
  let timeOfDay: string | null = null;

  let world: WorldRuntime | null = null;
  /** Fires when the current World is unmounted; its late loads must stop. */
  let worldAbort: AbortController | null = null;
  let worldRoot: THREE.Group | null = null;
  let worldBuilder: WorldBuilder | null = null;
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
    options.onPointerLockChange(locked, "lock");
  });
  on(document, "pointerlockerror", enterDragLook);

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
    if (keyboard.key === "Escape" && dragLook) {
      leaveDragLook();
      return;
    }
    if (keyboard.key === "Enter") {
      keyboard.preventDefault();
      keys.clear();
      options.onRequestChat();
      return;
    }
    if (keyboard.code === "KeyM" && !keyboard.repeat) {
      keyboard.preventDefault();
      keys.clear();
      options.onRequestMenu?.();
      return;
    }
    if (keyboard.code === "KeyE") {
      options.onInteract();
      return;
    }
    if (keyboard.code === "Space") {
      // Jump is edge-triggered; holding Space must not bunny-hop from repeat.
      if (engaged() && !keyboard.repeat) {
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
      engaged() &&
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
    if (!paused && !engaged()) engine.requestPointerLock();
  });

  // Touch look, and mouse look when the pointer cannot be locked. Touch drags
  // only on the right side, so it cannot fight the joystick on the left.
  on(renderer.domElement, "pointerdown", (event) => {
    const pointer = event as PointerEvent;
    if (paused) return;
    if (pointer.pointerType === "mouse") {
      if (!dragLook || pointer.button !== 0) return;
    } else if (pointer.clientX < window.innerWidth * 0.4) {
      return;
    }
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

  // The host, not the window: Plaza is embedded in an Activity frame whose
  // size changes without any window resize.
  let hostWidth = width;
  let hostHeight = height;
  const resize = () => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (w === 0 || h === 0 || (w === hostWidth && h === hostHeight)) return;
    hostWidth = w;
    hostHeight = h;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    teardown.push(() => observer.disconnect());
  } else {
    on(window, "resize", resize);
  }

  // A lost context otherwise leaves a frozen canvas with no explanation.
  on(renderer.domElement, "webglcontextlost", (event) => {
    event.preventDefault();
    contextLost = true;
    options.onError("The 3D view stopped. Reload the page.");
  });
  on(renderer.domElement, "webglcontextrestored", () => {
    contextLost = false;
    environment.restore();
  });

  // ---- frame ---------------------------------------------------------------

  const forward = new THREE.Vector3();
  const projected = new THREE.Vector3();

  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    if (contextLost) return;
    const frameMs = now - lastFrame;
    const dt = Math.min(frameMs / 1000, 0.05);
    lastFrame = now;
    const ratio = paused ? null : pixelRatio.sample(frameMs);
    if (ratio !== null) renderer.setPixelRatio(ratio);

    let right = 0;
    let ahead = 0;
    if (!paused) {
      right = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0) + joystick.x;
      ahead = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0) + joystick.y;
    }
    const crouching =
      keys.has("KeyC") || keys.has("ControlLeft") || mobileCrouch;
    const scale = world?.speedScale?.(camera.position.x, camera.position.z) ?? 1;
    const speed = (crouching ? CROUCH_SPEED : WALK_SPEED) * scale;
    const { vx, vz, magnitude } = movementVector(
      { right, forward: ahead },
      yaw,
      dt,
      speed,
    );
    const moved = resolveMovement(
      { x: camera.position.x, z: camera.position.z },
      { vx, vz },
      // Read live: `world.ts` replaces the array when exhibits arrive, so a
      // copy taken at mount would never see a plinth.
      // Obstacles you have jumped level with stop blocking (see `top`).
      blockingColliders(
        world?.colliders ?? NO_COLLIDERS,
        camera.position.y - (crouching ? CROUCH_EYE_HEIGHT : EYE_HEIGHT),
      ),
      undefined,
      WORLD_RADIUS,
      world?.walkable,
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

    world?.update?.(dt, devClock ?? now);

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
    worldAbort?.abort();
    worldAbort = null;
    world?.dispose();
    worldBuilder?.dispose();
    if (worldRoot) scene.remove(worldRoot);
    world = null;
    worldRoot = null;
    worldBuilder = null;
    groundY = null;
    environment.clear();
  }

  const engine: Engine = {
    scene,
    camera,
    reducedMotion,
    quality,
    labelHost: host,

    get world() {
      return world;
    },

    mount(definition) {
      // Dispose FIRST. Building the next World before releasing the current
      // one would briefly hold two full scenes, which is exactly the spike a
      // phone cannot absorb.
      unmountWorld();

      mountedDefinition = definition;
      const lighting = environment.apply(definition.environment, timeOfDay);
      const abort = new AbortController();
      worldAbort = abort;

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
        quality,
        lighting,
        signal: abort.signal,
      });
      world = runtime;
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
      // A frame that forbids the lock (sandbox without allow-pointer-lock)
      // refuses every request; steer by dragging instead of failing again.
      if (lockUnavailable || typeof renderer.domElement.requestPointerLock !== "function") {
        enterDragLook();
        return;
      }
      try {
        const result = renderer.domElement.requestPointerLock() as
          | Promise<void>
          | undefined;
        result?.catch?.(enterDragLook);
      } catch {
        enterDragLook();
      }
    },

    setPaused(next) {
      paused = next;
      // Chat takes the keyboard; the drag view resumes with the next request.
      if (next) leaveDragLook();
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

    setTimeOfDay(id) {
      timeOfDay = id;
      const entry = mountedDefinition?.environment.timesOfDay?.find(
        (candidate) => candidate.id === id,
      );
      if (entry) environment.retune(entry.sky);
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
      environment.dispose();
      hemisphere.dispose();
      sun.dispose();
      sun.shadow.map?.dispose();
      renderer.dispose();
      host.replaceChildren();
    },
  };

  // Verification harness, compiled out of production builds: fixed camera,
  // fixed World clock, renderer stats. Image comparisons need the same view
  // at the same instant, which pointer-lock input cannot reproduce.
  if (import.meta.env.DEV) {
    const harness = {
      renderer,
      scene,
      camera,
      quality,
      setView(x: number, z: number, nextYaw: number, nextPitch: number) {
        camera.position.x = x;
        camera.position.z = z;
        yaw = nextYaw;
        pitch = clampPitch(nextPitch);
      },
      setClock(ms: number | null) {
        devClock = ms;
      },
      /** Unmount and rebuild the current World in place (leak checks). */
      remount() {
        if (mountedDefinition) engine.mount(mountedDefinition);
      },
    };
    (window as unknown as { __plaza?: typeof harness }).__plaza = harness;
    teardown.push(() => {
      delete (window as unknown as { __plaza?: typeof harness }).__plaza;
    });
  }

  raf = requestAnimationFrame(frame);
  return engine;
}
