/**
 * The ten residents of Central Plaza, and the places they spend their day.
 *
 * Who they are and how they talk lives in guide/residents (the API reads it
 * too); here is how they look and where they like to be (the cranky one
 * keeps to the edges, the peppy one goes everywhere).
 */
import { CENTRAL_BENCHES } from "../worlds/centralGeometry";
import { shoreZ } from "../beach/coast";
import type { Spot } from "./schedule";
import { RESIDENT_PROFILES, type ResidentId, type ResidentProfile } from "../../guide/residents";

export type { Lines, Personality, Species } from "../../guide/residents";
export { CHATTER, LINES } from "../../guide/residents";

export interface ResidentSpec extends ResidentProfile {
  shirt: string;
  /** Spot groups this resident visits; undefined = anywhere. */
  likes?: readonly SpotKind[];
}

export type SpotKind = "bench" | "fountain" | "chat" | "shore" | "garden" | "exhibit" | "shade";

const yawToward = (fromX: number, fromZ: number, toX: number, toZ: number) =>
  Math.atan2(-(toX - fromX), -(toZ - fromZ));

/** Every place a resident can be, tagged by kind. */
export function plazaSpots(): { spot: Spot; kind: SpotKind }[] {
  const out: { spot: Spot; kind: SpotKind }[] = [];
  // Bench seats: two per bench, sitting, looking where the bench looks.
  CENTRAL_BENCHES.forEach(([x, z, rotation], bench) => {
    const fx = Math.sin(rotation);
    const fz = Math.cos(rotation);
    const rx = Math.cos(rotation);
    const rz = -Math.sin(rotation);
    for (const side of [-0.6, 0.6]) {
      const sx = x + rx * side + fx * 0.12;
      const sz = z + rz * side + fz * 0.12;
      out.push({
        kind: "bench",
        spot: {
          id: `bench-${bench}-${side < 0 ? "l" : "r"}`,
          x: sx,
          z: sz,
          yaw: Math.atan2(-fx, -fz),
          pose: "sit",
          approach: { x: sx + fx * 1.5, z: sz + fz * 1.5 },
          group: `bench-${bench}`,
        },
      });
    }
  });
  // Around the fountain rim, looking at the water.
  for (const angle of [0.45, 1.25, 2.1, 3.7, 4.5, 5.35]) {
    const x = Math.sin(angle) * 3.9;
    const z = -Math.cos(angle) * 3.9;
    out.push({ kind: "fountain", spot: { id: `fountain-${angle}`, x, z, yaw: yawToward(x, z, 0, 0), pose: "stand" } });
  }
  // Conversation corners: pairs that face each other.
  for (const [name, ax, az, bx, bz] of [
    ["west", -14.4, -3.2, -14.4, -2.0],
    ["south", -3.4, -4.6, -2.2, -4.6],
    ["east", 5.6, 8.6, 6.5, 9.4],
  ] as const) {
    out.push({ kind: "chat", spot: { id: `chat-${name}-a`, x: ax, z: az, yaw: yawToward(ax, az, bx, bz), pose: "stand", group: `chat-${name}` } });
    out.push({ kind: "chat", spot: { id: `chat-${name}-b`, x: bx, z: bz, yaw: yawToward(bx, bz, ax, az), pose: "stand", group: `chat-${name}` } });
  }
  // Down by the water, looking out to sea.
  for (const x of [-9, -2.5, 5, 12]) {
    const z = shoreZ(x) + 3;
    out.push({ kind: "shore", spot: { id: `shore-${x}`, x, z, yaw: 0, pose: "stand", group: "shore" } });
  }
  // By the planters, admiring the plants.
  out.push({ kind: "garden", spot: { id: "garden-w", x: -9.5, z: 6.3, yaw: 0, pose: "stand" } });
  out.push({ kind: "garden", spot: { id: "garden-e", x: 9.5, z: 6.3, yaw: 0, pose: "stand" } });
  // In front of the Software exhibits.
  out.push({ kind: "exhibit", spot: { id: "exhibit-w", x: -3.2, z: -9.8, yaw: 0.2, pose: "stand", group: "exhibit" } });
  out.push({ kind: "exhibit", spot: { id: "exhibit-e", x: 3.2, z: -9.8, yaw: -0.2, pose: "stand", group: "exhibit" } });
  // Palm shade at the plaza's edge.
  for (const [x, z] of [[-16, 6], [15.5, 8.5], [-12, -13], [13, -15]] as const) {
    out.push({ kind: "shade", spot: { id: `shade-${x}`, x, z, yaw: yawToward(x, z, 0, 0), pose: "stand" } });
  }
  return out;
}

/** How each resident looks and where they like to be; who they are is in guide/residents. */
const STYLE: Record<ResidentId, Pick<ResidentSpec, "shirt" | "likes">> = {
  cat: { shirt: "#e7c26a", likes: ["bench", "shade", "garden", "fountain"] },
  dog: { shirt: "#d5534b" },
  panda: { shirt: "#8fc0a9" },
  fox: { shirt: "#3f5f8f", likes: ["exhibit", "fountain", "chat", "bench"] },
  penguin: { shirt: "#f29bb2" },
  rabbit: { shirt: "#7b6bb3" },
  bear: { shirt: "#5d6b4a", likes: ["shade", "shore", "bench"] },
  koala: { shirt: "#c7a3d8", likes: ["garden", "fountain", "exhibit", "chat"] },
  frog: { shirt: "#f5d04f", likes: ["fountain", "shore", "chat", "garden"] },
  owl: { shirt: "#e48f4f", likes: ["bench", "exhibit", "shade", "chat"] },
};

export const RESIDENTS: readonly ResidentSpec[] = RESIDENT_PROFILES.map((profile) => ({
  ...profile,
  ...STYLE[profile.id],
}));
