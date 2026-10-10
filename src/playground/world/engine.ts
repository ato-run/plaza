import { beginVisualInput, measureVisualFrame } from "./openAir/metrics";
import { visibleSky } from "./openAir/lighting";
import { mantleTarget } from "./openAir/mantle";
import { createBeachAudio } from "./openAir/audio";
import { readSettings, type ExploreSettings } from "./openAir/settings";
import { worldMoment } from "./openAir/clock";
import { waterDepth } from "./beach/coast";
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
import { deferWorldAssets } from "./startup";

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
  retainedBytes(): number;
  setSettings(settings: ExploreSettings): void;
  setJoystick(x: number, y: number): void;
  /** Touch jump button (keyboard uses Space). Ignored while paused. */
  jump(held?: boolean): void;
  /**
   * Light the place as this time of day (an id from the World's
   * `timesOfDay`); kept across World switches, ignored by Worlds without it.
   */
  setTimeOfDay(id: string | null): void;
  /** Touch crouch toggle. ORed with the held C / Control keys. */
  setCrouching(crouching: boolean): void;
  /** Screen position for a world point, or null when off-screen/behind. */
  project(
    point: THREE.Vector3,
  ): { left: number; top: number; distance: number } | null;
  cadenceDue(now: number): boolean;
  dispose(): void;
}

const REACTION_KEYS = ["Digit1", "Digit2", "Digit3", "Digit4"];
const NO_COLLIDERS: readonly Collider[] = [];
/** How long a jump pressed in mid-air waits for the ground. */
const JUMP_BUFFER_MS = 150;

export function createEngine(options: EngineOptions): Engine {
  const rendererStarted = performance.now();
  let settings = readSettings();
  const audio = createBeachAudio();
  audio.volume(settings.volume);
  let resumeView = false,
    skyKey = "",
    lastWaterWarning = 0;
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
            coarsePointer:
              window.matchMedia?.("(pointer: coarse)").matches ?? false,
            shortSide: Math.min(
              window.screen?.width ?? width,
              window.screen?.height ?? height,
            ),
            cores: navigator.hardwareConcurrency || undefined,
            memoryGb: (navigator as Navigator & { deviceMemory?: number })
              .deviceMemory,
          })
    ];
  const pixelRatio = new PixelRatioController(
    quality,
    window.devicePixelRatio || 1,
  );
  renderer.setPixelRatio(pixelRatio.current);
  renderer.setSize(width, height);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  host.appendChild(renderer.domElement);
  window.atoStartup.measure("renderer", performance.now() - rendererStarted);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    settings.fov,
    width / height,
    0.05,
    110,
  );
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
  const environment = createEnvironment(
    renderer,
    scene,
    camera,
    sun,
    hemisphere,
  );

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
    jumpHeld = false;
    world?.openAir?.cancelCharge();
    jumpRequested = false;
    mantle = null;
    options.onPointerLockChange(true, "drag");
  };
  const leaveDragLook = () => {
    if (!dragLook) return;
    dragLook = false;
    dragPointer = -1;
    keys.clear();
    jumpHeld = false;
    world?.openAir?.cancelCharge();
    jumpRequested = false;
    mantle = null;
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
  let mantle: {
    from: THREE.Vector3;
    x: number;
    z: number;
    y: number;
    elapsed: number;
  } | null = null;
  let jumpRequested = false;
  // When the jump was asked for. A press made a moment before touching down
  // (a step, a dune, the end of the last jump) is kept briefly and honoured
  // on landing instead of being dropped.
  let jumpRequestedAt = 0;
  let jumpHeld = false,
    lastGroundedAt = 0,
    landingKick = 0,
    seatedId: string | null = null;
  let seatTurn: {
    from: number;
    to: number;
    pitch: number;
    elapsed: number;
  } | null = null;
  const pressed = (action: keyof ExploreSettings["keys"]) =>
    keys.has(settings.keys[action]);
  const requestJump = () => {
    jumpRequested = true;
    jumpRequestedAt = performance.now();
  };
  let mobileCrouch = false;

  /** Dev harness only: a pinned World clock for same-frame comparisons. */
  let devClock: number | null = null;
  let mountedDefinition: WorldDefinition | null = null;
  let timeOfDay: string | null = null;

  let world: WorldRuntime | null = null;
  /** Fires when the current World is unmounted; its late loads must stop. */
  let worldAbort: AbortController | null = null;
  let worldFirstFrame: (() => void) | null = null;
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
    jumpHeld = false;
    world?.openAir?.cancelCharge();
    jumpRequested = false;
    mantle = null;
    options.onPointerLockChange(locked, "lock");
  });
  on(document, "pointerlockerror", enterDragLook);

  on(document, "mousemove", (event) => {
    if (!locked || paused) return;
    beginVisualInput("look");
    const mouse = event as MouseEvent;
    yaw -= mouse.movementX * 0.0022 * settings.sensitivity;
    pitch = clampPitch(
      pitch -
        mouse.movementY *
          0.0022 *
          settings.sensitivity *
          (settings.invertY ? -1 : 1),
    );
  });

  on(window, "keydown", (event) => {
    const keyboard = event as KeyboardEvent;
    const tag = (keyboard.target as HTMLElement | null)?.tagName;
    if (
      paused ||
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "BUTTON" ||
      tag === "SELECT"
    )
      return;
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
    if (
      (keyboard.code === settings.keys.place ||
        keyboard.code === settings.keys.throw) &&
      !keyboard.repeat
    ) {
      if (keyboard.code === settings.keys.throw) world?.openAir?.charge(true);
      else world?.openAir?.useHeld(false);
      return;
    }
    if (keyboard.code === settings.keys.rotate && !keyboard.repeat) {
      world?.openAir?.rotateHeld();
      return;
    }
    if (keyboard.code === settings.keys.mark && !keyboard.repeat) {
      world?.openAir?.mark();
      return;
    }
    if (keyboard.code === settings.keys.interact) {
      options.onInteract();
      return;
    }
    if (keyboard.code === settings.keys.jump) {
      // Jump is edge-triggered; holding Space must not bunny-hop from repeat.
      if (engaged() && !keyboard.repeat) {
        keyboard.preventDefault();
        requestJump();
        jumpHeld = true;
      }
      return;
    }
    const reactionIndex = REACTION_KEYS.indexOf(keyboard.code);
    if (reactionIndex >= 0) {
      options.onReaction(reactionIndex);
      return;
    }
    if (engaged() && Object.values(settings.keys).includes(keyboard.code)) {
      if (keyboard.code !== "ControlLeft") keyboard.preventDefault();
      beginVisualInput(keyboard.code.startsWith("Arrow") ? "look" : "movement");
      keys.add(keyboard.code);
    }
  });

  on(window, "keyup", (event) => {
    const code = (event as KeyboardEvent).code;
    keys.delete(code);
    if (code === settings.keys.jump) jumpHeld = false;
    if (!paused && code === settings.keys.throw) world?.openAir?.charge(false);
  });
  on(window, "blur", () => {
    keys.clear();
    jumpHeld = false;
    world?.openAir?.cancelCharge();
    jumpRequested = false;
    mantle = null;
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
    beginVisualInput("look");
    yaw -= (pointer.clientX - dragX) * 0.003 * settings.sensitivity;
    pitch = clampPitch(
      pitch -
        (pointer.clientY - dragY) *
          0.003 *
          settings.sensitivity *
          (settings.invertY ? -1 : 1),
    );
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
      right =
        (pressed("right") ? 1 : 0) - (pressed("left") ? 1 : 0) + joystick.x;
      ahead =
        (pressed("forward") ? 1 : 0) - (pressed("back") ? 1 : 0) + joystick.y;
    }
    if (!paused) {
      yaw +=
        ((pressed("lookLeft") ? 1 : 0) - (pressed("lookRight") ? 1 : 0)) *
        dt *
        1.6 *
        settings.sensitivity;
      pitch = clampPitch(
        pitch +
          ((pressed("lookUp") ? 1 : 0) - (pressed("lookDown") ? 1 : 0)) *
            dt *
            1.3 *
            settings.sensitivity,
      );
    }
    let seat = world?.openAir?.seat() ?? null;
    if (seat && seatedId !== seat.id) {
      if (!reducedMotion)
        seatTurn = {
          from: yaw,
          to:
            yaw +
            Math.atan2(Math.sin(seat.yaw - yaw), Math.cos(seat.yaw - yaw)),
          pitch,
          elapsed: 0,
        };
      else {
        yaw = seat.yaw;
        pitch = -0.02;
      }
    }
    if (seatTurn && seat) {
      seatTurn.elapsed += dt;
      const t = Math.min(1, seatTurn.elapsed / 0.24),
        ease = t * t * (3 - 2 * t);
      yaw = seatTurn.from + (seatTurn.to - seatTurn.from) * ease;
      pitch = seatTurn.pitch + (-0.02 - seatTurn.pitch) * ease;
      if (t === 1) seatTurn = null;
    }
    if (!seat) seatTurn = null;
    seatedId = seat?.id ?? null;
    if (seat && !paused && (right || ahead || jumpRequested)) {
      world?.openAir?.stand();
      camera.position.z = seat.z - 1;
      camera.position.y = (groundY?.(seat.x, seat.z - 1) ?? 0) + EYE_HEIGHT;
      vy = 0;
      seat = null;
    }
    const crouching =
      pressed("crouch") || keys.has("ControlLeft") || mobileCrouch;
    const scale =
      world?.speedScale?.(camera.position.x, camera.position.z) ?? 1;
    const speed =
      (crouching
        ? CROUCH_SPEED
        : pressed("run")
          ? WALK_SPEED * 1.6
          : WALK_SPEED) * scale;
    const { vx, vz, magnitude } = movementVector(
      { right, forward: ahead },
      yaw,
      dt,
      speed,
    );
    if (!paused && !mantle && grounded && jumpRequested && magnitude > 0.05) {
      const target = mantleTarget(
        camera.position,
        { x: vx, z: vz },
        camera.position.y - (crouching ? CROUCH_EYE_HEIGHT : EYE_HEIGHT),
        world?.colliders ?? NO_COLLIDERS,
        world?.walkable,
      );
      if (target) {
        world?.openAir?.feedback("Climbing the ledge…");
        audio.landing("stone", 2);
        mantle = {
          from: camera.position.clone(),
          x: target.x,
          z: target.z,
          y: target.top + (crouching ? CROUCH_EYE_HEIGHT : EYE_HEIGHT),
          elapsed: 0,
        };
        jumpRequested = false;
      }
    }
    const moved = resolveMovement(
      { x: camera.position.x, z: camera.position.z },
      { vx, vz },
      // Read live: `world.ts` replaces the array when exhibits arrive, so a
      // copy taken at mount would never see a plinth.
      // Obstacles you have jumped level with stop blocking (see `top`).
      blockingColliders(
        world?.colliders ?? NO_COLLIDERS,
        camera.position.y -
          (crouching ? CROUCH_EYE_HEIGHT : EYE_HEIGHT) +
          (grounded ? 0.24 : 0),
      ),
      undefined,
      WORLD_RADIUS,
      world?.walkable,
    );
    if (
      magnitude > 0.05 &&
      Math.hypot(moved.x - camera.position.x, moved.z - camera.position.z) <
        0.001 &&
      waterDepth(camera.position.x, camera.position.z) > 0.4 &&
      now - lastWaterWarning > 4500
    ) {
      lastWaterWarning = now;
      audio.splash();
    }
    camera.position.x = moved.x;
    camera.position.z = moved.z;
    // Vertical: stick to small terrain changes, fall off edges, arc on jump.
    const groundEye =
      (groundY ? groundY(moved.x, moved.z) : 0) +
      (crouching ? CROUCH_EYE_HEIGHT : EYE_HEIGHT);
    if (grounded) lastGroundedAt = now;
    const coyoteJump =
      jumpRequested && !grounded && vy <= 0 && now - lastGroundedAt < 100;
    if (vy > 0 && !jumpHeld && now - jumpRequestedAt > 85)
      vy = Math.min(vy, 2.2);
    const impact = vy;
    const wasGrounded = grounded;
    const vertical = stepVertical(
      { y: camera.position.y, vy, grounded: grounded || coyoteJump },
      dt,
      groundEye,
      jumpRequested && !paused,
    );
    if (
      jumpRequested &&
      (grounded ||
        coyoteJump ||
        performance.now() - jumpRequestedAt > JUMP_BUFFER_MS)
    ) {
      jumpRequested = false;
    }
    if (!wasGrounded && vertical.grounded && impact < -1) {
      landingKick = Math.min(0.08, -impact * 0.008);
      audio.landing(world?.openAir?.surface() ?? "sand", -impact);
    }
    vy = vertical.vy;
    grounded = vertical.grounded;
    camera.position.y = vertical.y;
    if (mantle && !paused) {
      mantle.elapsed += dt;
      const progress = Math.min(1, mantle.elapsed / 0.24),
        ease = progress * progress * (3 - 2 * progress);
      camera.position.set(
        mantle.from.x + (mantle.x - mantle.from.x) * ease,
        mantle.from.y +
          (mantle.y - mantle.from.y) * Math.sin((progress * Math.PI) / 2),
        mantle.from.z + (mantle.z - mantle.from.z) * ease,
      );
      vy = 0;
      grounded = progress === 1;
      if (progress === 1) {
        mantle = null;
        world?.openAir?.feedback("Climbed the ledge.");
        audio.landing(world?.openAir?.surface() ?? "stone", 2);
      }
    }
    if (seat) {
      camera.position.set(seat.x, seat.top + 0.9, seat.z);
      vy = 0;
      grounded = true;
    }
    camera.rotation.set(pitch, yaw, 0, "YXZ");
    camera.getWorldDirection(forward);

    world?.openAir?.setEye(
      camera.position,
      forward,
      crouching,
      magnitude > 0.05,
    );
    world?.update?.(dt, devClock ?? now, camera.position);
    const moment = worldMoment(world?.openAir?.now() ?? Date.now());
    if (world?.openAir) {
      const sound = world.openAir.takeSound();
      if (sound === "splash") audio.splash();
      else if (sound === "chime") audio.chime();
      const worldNow = world.openAir.now();
      const key = `${timeOfDay ?? Math.floor(worldNow / 15000)}:${moment.weather}`;
      const sky = visibleSky(
        mountedDefinition?.environment.timesOfDay ?? [],
        worldNow,
        timeOfDay,
      );
      if (sky)
        environment.retune(
          moment.weather === "rain"
            ? { ...sky, clouds: 0.95, sunIntensity: sky.sunIntensity * 0.45 }
            : sky,
          key !== skyKey,
        );
      skyKey = key;
      world.openAir.setLighting(timeOfDay);
      if (Math.floor(now / 2800) !== Math.floor((now - frameMs) / 2800)) {
        if (moment.weather !== "rain")
          audio.activity(
            camera.position.x,
            camera.position.z,
            -19,
            -29,
            yaw,
            "crab",
          );
        audio.activity(
          camera.position.x,
          camera.position.z,
          23,
          17,
          yaw,
          "repair",
        );
      }
      audio.update(
        camera.position.x,
        camera.position.z,
        yaw,
        magnitude > 0.05,
        waterDepth(camera.position.x, camera.position.z) + moment.tide > 0,
        Math.hypot(camera.position.x, camera.position.z) < 3.5,
        camera.position.x > 20 &&
          camera.position.x < 24 &&
          camera.position.z < -23,
        now,
        moment.wind,
      );
    }

    const pose: Pose = seat ? "sit" : crouching ? "crouch" : "stand";
    frameHandler?.({
      now,
      dt,
      movement: !grounded ? "jump" : magnitude > 0.05 ? "walk" : "idle",
      pose,
      forward,
    });

    const bob =
      settings.motion && !reducedMotion && grounded && magnitude > 0.05
        ? Math.sin(now * 0.009) * 0.016
        : 0;
    landingKick *= Math.exp(-dt * 18);
    const landingMotion = settings.motion && !reducedMotion ? -landingKick : 0;
    const mantlePitch =
      mantle && settings.motion && !reducedMotion
        ? Math.sin(Math.min(1, mantle.elapsed / 0.24) * Math.PI) * 0.055
        : 0;
    camera.rotation.x -= mantlePitch;
    camera.position.y += bob + landingMotion;
    const renderStarted = worldFirstFrame ? performance.now() : null;
    renderer.render(scene, camera);
    measureVisualFrame();
    if (renderStarted !== null)
      window.atoStartup.measure(
        "first-frame",
        performance.now() - renderStarted,
      );
    camera.position.y -= bob + landingMotion;
    camera.rotation.x += mantlePitch;
    // This is a render milestone, not proof of shared-state readiness or use.
    const rendered = worldFirstFrame;
    worldFirstFrame = null;
    rendered?.();
  }

  function unmountWorld(): void {
    worldAbort?.abort();
    worldAbort = null;
    worldFirstFrame = null;
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

      const buildStarted = performance.now();
      const runtime = definition.build({
        root,
        builder,
        labelHost: host,
        reducedMotion,
        quality,
        lighting,
        signal: abort.signal,
      });
      window.atoStartup.measure("world", performance.now() - buildStarted);
      world = runtime;
      groundY = runtime.groundY ?? null;

      camera.position.set(
        definition.spawn.x,
        (runtime.groundY?.(definition.spawn.x, definition.spawn.z) ??
          definition.spawn.y) + EYE_HEIGHT,
        definition.spawn.z,
      );
      yaw = definition.spawn.yaw;
      pitch = -0.03;
      // A World change is a teleport: land standing, with no held keys or
      // queued jump surviving into the new place.
      vy = 0;
      grounded = true;
      jumpRequested = false;
      mantle = null;
      mobileCrouch = false;
      keys.clear();
      // A World change is a teleport; the next transform must go out
      // immediately rather than waiting out the cadence, or peers see the
      // arrival up to 83ms late in the wrong place.
      cadence.reset();
      worldFirstFrame = deferWorldAssets(abort, runtime.deferred ?? []);
    },

    onFrame(handler) {
      frameHandler = handler;
    },

    requestPointerLock() {
      audio.start();
      // Touch devices have no pointer to lock; drag-look is the equivalent.
      if (window.matchMedia?.("(pointer: coarse)").matches) {
        enterDragLook();
        return;
      }
      // A frame that forbids the lock (sandbox without allow-pointer-lock)
      // refuses every request; steer by dragging instead of failing again.
      if (
        lockUnavailable ||
        typeof renderer.domElement.requestPointerLock !== "function"
      ) {
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

    setSettings(next) {
      settings = next;
      audio.volume(next.volume);
      camera.fov = next.fov;
      camera.updateProjectionMatrix();
    },
    retainedBytes() {
      // Conservative budget estimate, including heap and GPU copies. It is
      // admission guidance, not a browser-process RSS measurement.
      let bytes =
        64 * 1024 * 1024 +
        renderer.domElement.width * renderer.domElement.height * 16;
      const geometries = new Set<THREE.BufferGeometry>(),
        textures = new Set<THREE.Texture>();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) geometries.add(mesh.geometry);
        const materials = mesh.material
          ? Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material]
          : [];
        for (const material of materials)
          for (const value of Object.values(material)) {
            if (value instanceof THREE.Texture) textures.add(value);
          }
      });
      for (const geometry of geometries) {
        for (const attribute of Object.values(geometry.attributes))
          bytes += attribute.array.byteLength * 2;
        bytes += (geometry.index?.array.byteLength ?? 0) * 2;
      }
      for (const texture of textures) {
        const image = texture.image as
          | { width?: number; height?: number }
          | undefined;
        if (!image?.width || !image.height) return Infinity;
        bytes +=
          image.width * image.height * 4 * (texture.generateMipmaps ? 3 : 2);
      }
      const heap = (
        performance as Performance & { memory?: { usedJSHeapSize: number } }
      ).memory?.usedJSHeapSize;
      return Number.isFinite(heap) ? Math.max(bytes, heap!) : bytes;
    },
    setPaused(next) {
      if (next && !paused) resumeView = engaged();
      paused = next;
      // Chat takes the keyboard; the drag view resumes with the next request.
      if (next) leaveDragLook();
      else if (resumeView) {
        enterDragLook();
        resumeView = false;
      }
      keys.clear();
      jumpRequested = false;
      mantle = null;
      joystick.x = 0;
      joystick.y = 0;
    },

    setJoystick(x, y) {
      beginVisualInput("movement");
      joystick.x = x;
      joystick.y = y;
    },

    jump(held = true) {
      jumpHeld = held;
      if (!paused && held) requestJump();
    },

    setTimeOfDay(id) {
      timeOfDay = id;
      skyKey = "";
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
      audio.dispose();
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
