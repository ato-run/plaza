/** Shared 24-minute day. Personal lighting never enters this function. */
export const DAY_MS = 24 * 60 * 1000;
export interface WorldMoment {
  phase: "day" | "sunset" | "night" | "dawn";
  tide: number;
  weather: "clear" | "wind" | "rain";
  wind: number;
  day: number;
  progress: number;
  tideDirection: "rising" | "falling" | "high" | "low";
  windX: number;
  windZ: number;
  currentX: number;
  currentZ: number;
}
export function worldMoment(now: number): WorldMoment {
  const day = Math.floor(now / DAY_MS);
  const progress = (((now % DAY_MS) + DAY_MS) % DAY_MS) / DAY_MS;
  const phase =
    progress < 0.55
      ? "day"
      : progress < 0.68
        ? "sunset"
        : progress < 0.93
          ? "night"
          : "dawn";
  const weatherIndex = ((Math.floor(now / 240000) % 7) + 7) % 7;
  const weather =
    weatherIndex === 5
      ? "rain"
      : weatherIndex === 2 || weatherIndex === 3
        ? "wind"
        : "clear";
  return {
    phase,
    progress,
    tideDirection:
      Math.abs(Math.cos(now / 180000)) < 0.12
        ? Math.sin(now / 180000) > 0
          ? "high"
          : "low"
        : Math.cos(now / 180000) > 0
          ? "rising"
          : "falling",
    windX: Math.cos(day * 0.7 + weatherIndex * 0.4),
    windZ: Math.sin(day * 0.7 + weatherIndex * 0.4),
    currentX: 0.8,
    currentZ: -0.6,
    tide: Math.sin(now / 180000) * 0.18,
    weather,
    wind: weather === "wind" ? 1 : weather === "rain" ? 0.7 : 0.25,
    day,
  };
}
