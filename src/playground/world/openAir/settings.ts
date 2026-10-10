export const DEFAULT_KEYS = {
  forward: "KeyW",
  back: "KeyS",
  left: "KeyA",
  right: "KeyD",
  jump: "Space",
  crouch: "KeyC",
  run: "ShiftLeft",
  interact: "KeyE",
  place: "KeyQ",
  throw: "KeyF",
  rotate: "KeyR",
  mark: "KeyG",
  lookLeft: "ArrowLeft",
  lookRight: "ArrowRight",
  lookUp: "ArrowUp",
  lookDown: "ArrowDown",
} as const;
export type InputAction = keyof typeof DEFAULT_KEYS;
export interface ExploreSettings {
  sensitivity: number;
  invertY: boolean;
  motion: boolean;
  volume: number;
  fov: number;
  keys: Record<InputAction, string>;
}
export const DEFAULT_SETTINGS: ExploreSettings = {
  sensitivity: 0.65,
  invertY: false,
  motion: false,
  volume: 0.35,
  fov: 64,
  keys: { ...DEFAULT_KEYS },
};
export function isBindableKey(code: string): boolean {
  // Menu, conversation and reactions retain their universal shortcuts.
  return /^(Key[A-LN-Z]|Space|Arrow(Left|Right|Up|Down)|Shift(Left|Right))$/.test(
    code,
  );
}
export function rebindKey(
  keys: Record<InputAction, string>,
  action: InputAction,
  code: string,
): Record<InputAction, string> | null {
  if (
    !isBindableKey(code) ||
    Object.entries(keys).some(
      ([name, value]) => name !== action && value === code,
    )
  )
    return null;
  return { ...keys, [action]: code };
}
export function normalizeSettings(value: unknown): ExploreSettings {
  const v =
    value && typeof value === "object"
      ? (value as Partial<ExploreSettings>)
      : {};
  const finite = (n: unknown, fallback: number, min: number, max: number) =>
    typeof n === "number" && Number.isFinite(n)
      ? Math.max(min, Math.min(max, n))
      : fallback;
  const keys = { ...DEFAULT_KEYS } as Record<InputAction, string>;
  for (const action of Object.keys(keys) as InputAction[]) {
    const code = v.keys?.[action];
    if (typeof code === "string" && isBindableKey(code)) keys[action] = code;
  }
  if (new Set(Object.values(keys)).size !== Object.keys(keys).length)
    Object.assign(keys, DEFAULT_KEYS);
  return {
    sensitivity: finite(v.sensitivity, 0.65, 0.2, 2),
    volume: finite(v.volume, 0.35, 0, 1),
    fov: finite(v.fov, 64, 50, 95),
    invertY: v.invertY === true,
    motion: v.motion === true,
    keys,
  };
}
export function readSettings(): ExploreSettings {
  try {
    return normalizeSettings(
      JSON.parse(localStorage.getItem("plaza.explore-settings") ?? "{}"),
    );
  } catch {
    return normalizeSettings(null);
  }
}
