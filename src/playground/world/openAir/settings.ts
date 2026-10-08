export interface ExploreSettings {
  sensitivity: number;
  invertY: boolean;
  motion: boolean;
  volume: number;
}
export const DEFAULT_SETTINGS: ExploreSettings = {
  sensitivity: 0.65,
  invertY: false,
  motion: false,
  volume: 0.35,
};
export function readSettings(): ExploreSettings {
  try {
    const v = JSON.parse(
      localStorage.getItem("plaza.explore-settings") ?? "{}",
    );
    return {
      ...DEFAULT_SETTINGS,
      ...v,
      sensitivity: Math.max(0.2, Math.min(2, Number(v.sensitivity) || 0.65)),
      volume: Math.max(
        0,
        Math.min(1, Number.isFinite(v.volume) ? v.volume : 0.35),
      ),
      invertY: v.invertY === true,
      motion: v.motion === true,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
