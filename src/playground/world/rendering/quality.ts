/**
 * How much of the GPU a device gets asked for.
 *
 * Two tiers, chosen once at start from what the browser reports, then one
 * continuous knob — the render pixel ratio — moved by measured frame time.
 * Only the pixel ratio adapts at runtime: changing it costs nothing to
 * compile, and DOM text (names, chat, the HUD) is not rendered by WebGL, so
 * it stays sharp whatever the 3D resolution does.
 */

export type QualityLevel = "high" | "low";

export interface QualityProfile {
  readonly level: QualityLevel;
  /** Upper bound for the renderer's pixel ratio. */
  readonly maxPixelRatio: number;
  /** Lower bound the adaptive controller may drop to. */
  readonly minPixelRatio: number;
  readonly shadowMapSize: number;
  /** Ocean mesh density: segments round the ring. Rings scale with it. */
  readonly oceanSegments: number;
  /** Beach grass and other optional set dressing. */
  readonly scatter: boolean;
}

export const QUALITY_PROFILES: Record<QualityLevel, QualityProfile> = {
  high: {
    level: "high",
    maxPixelRatio: 1.6,
    minPixelRatio: 1,
    shadowMapSize: 2048,
    oceanSegments: 320,
    scatter: true,
  },
  low: {
    level: "low",
    maxPixelRatio: 1.25,
    minPixelRatio: 0.85,
    shadowMapSize: 1024,
    oceanSegments: 160,
    scatter: false,
  },
};

export interface DeviceHints {
  coarsePointer: boolean;
  shortSide: number;
  cores?: number;
  memoryGb?: number;
}

/** Phones and small or weak machines start on Low. */
export function detectQuality(hints: DeviceHints): QualityLevel {
  if (hints.coarsePointer && hints.shortSide < 820) return "low";
  if (hints.cores !== undefined && hints.cores <= 4) return "low";
  if (hints.memoryGb !== undefined && hints.memoryGb <= 4) return "low";
  return "high";
}

/**
 * Frame-time driven pixel ratio, with hysteresis.
 *
 * Decisions are made over whole windows of frames, and dropping needs a
 * clearly slow window while rising needs two clearly fast ones in a row, so
 * the ratio never oscillates frame to frame. A paused tab produces huge
 * deltas; those are not evidence about the GPU and are ignored.
 */
export class PixelRatioController {
  private samples: number[] = [];
  private fastWindows = 0;
  current: number;

  constructor(
    private readonly profile: QualityProfile,
    private readonly deviceRatio: number,
    private readonly windowSize = 90,
  ) {
    this.current = Math.min(deviceRatio, profile.maxPixelRatio);
  }

  /** Record one frame; returns a new ratio when it should change, else null. */
  sample(frameMs: number): number | null {
    if (frameMs <= 0 || frameMs > 250) return null;
    this.samples.push(frameMs);
    if (this.samples.length < this.windowSize) return null;
    const sorted = [...this.samples].sort((a, b) => a - b);
    this.samples = [];
    const median = sorted[Math.floor(sorted.length / 2)];
    const ceiling = Math.min(this.deviceRatio, this.profile.maxPixelRatio);
    if (median > 24 && this.current > this.profile.minPixelRatio) {
      this.fastWindows = 0;
      this.current = Math.max(this.profile.minPixelRatio, round(this.current - 0.15));
      return this.current;
    }
    if (median < 14 && this.current < ceiling) {
      this.fastWindows += 1;
      if (this.fastWindows < 2) return null;
      this.fastWindows = 0;
      this.current = Math.min(ceiling, round(this.current + 0.1));
      return this.current;
    }
    this.fastWindows = 0;
    return null;
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
