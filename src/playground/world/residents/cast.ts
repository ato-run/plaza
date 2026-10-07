/**
 * The ten residents of Central Plaza, and the places they spend their day.
 *
 * Personalities in the villager tradition — lazy, peppy, cranky, smug,
 * sisterly, jock, normal, snooty — decide how they talk; `homes` decides
 * where they like to be (the cranky one keeps to the edges, the peppy one
 * goes everywhere).
 */
import { CENTRAL_BENCHES } from "../worlds/centralGeometry";
import { shoreZ } from "../beach/coast";
import type { Spot } from "./schedule";

export type Species =
  | "cat" | "dog" | "panda" | "fox" | "penguin"
  | "rabbit" | "bear" | "koala" | "frog" | "owl";

export type Personality =
  | "lazy" | "peppy" | "cranky" | "smug" | "sisterly" | "jock" | "normal" | "snooty";

export interface ResidentSpec {
  id: string;
  name: string;
  species: Species;
  personality: Personality;
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

export const RESIDENTS: readonly ResidentSpec[] = [
  { id: "cat", name: "Calico", species: "cat", personality: "lazy", shirt: "#e7c26a", likes: ["bench", "shade", "garden", "fountain"] },
  { id: "dog", name: "Sora", species: "dog", personality: "jock", shirt: "#d5534b" },
  { id: "panda", name: "Momo", species: "panda", personality: "normal", shirt: "#8fc0a9" },
  { id: "fox", name: "Rusty", species: "fox", personality: "smug", shirt: "#3f5f8f", likes: ["exhibit", "fountain", "chat", "bench"] },
  { id: "penguin", name: "Pip", species: "penguin", personality: "peppy", shirt: "#f29bb2" },
  { id: "rabbit", name: "Clover", species: "rabbit", personality: "sisterly", shirt: "#7b6bb3" },
  { id: "bear", name: "Bruno", species: "bear", personality: "cranky", shirt: "#5d6b4a", likes: ["shade", "shore", "bench"] },
  { id: "koala", name: "Kiki", species: "koala", personality: "snooty", shirt: "#c7a3d8", likes: ["garden", "fountain", "exhibit", "chat"] },
  { id: "frog", name: "Lily", species: "frog", personality: "peppy", shirt: "#f5d04f", likes: ["fountain", "shore", "chat", "garden"] },
  { id: "owl", name: "Olive", species: "owl", personality: "normal", shirt: "#e48f4f", likes: ["bench", "exhibit", "shade", "chat"] },
];

export interface Lines {
  greet: readonly string[];
  talk: readonly string[];
  muse: readonly string[];
}

export const LINES: Record<Personality, Lines> = {
  lazy: {
    greet: ["Oh, hey... you came by.", "Mmm, hi there."],
    talk: ["The sun's just right for a nap.", "I found a bench that's exactly the right temperature.", "Ever notice how the waves sound like snoring?"],
    muse: ["Zzz... huh? I'm awake.", "Snack time soon, I hope."],
  },
  peppy: {
    greet: ["Hiya! Oh, I'm so glad you're here!", "Hey hey! Look who it is!"],
    talk: ["Did you see the fountain sparkle? So pretty!", "Let's all go to the beach later, okay?", "Try jumping onto the fountain rim! It's the best!"],
    muse: ["La la la~", "Ooh, a shell!"],
  },
  cranky: {
    greet: ["Hmph. Oh, it's you.", "Mm. Afternoon."],
    talk: ["Back in my day, plazas didn't have fountains.", "The young ones run around too much.", "...The sea's nice. Don't tell anyone I said that."],
    muse: ["Hmph.", "Too many seagulls today."],
  },
  smug: {
    greet: ["Ah, splendid timing.", "Well, hello there, friend."],
    talk: ["I make a point of visiting the exhibits daily. Culture, you know.", "The sunset here is almost as refined as I am.", "Have you tried the apps on display? I have opinions."],
    muse: ["Simply marvelous.", "Hm, this light suits me."],
  },
  sisterly: {
    greet: ["Hey, you! Doing okay?", "There you are! Come on over."],
    talk: ["If anyone gives you trouble, you tell me.", "Don't stay in the sun too long, okay?", "Nagi knows everything about this place. Ask her!"],
    muse: ["Ugh, sand in my shoes again.", "Nice breeze today."],
  },
  jock: {
    greet: ["Yo! Ready to work out?", "Hey, champ!"],
    talk: ["Walking to the water and back counts as cardio!", "I jumped onto the fountain ten times this morning!", "Wading in the shallows is great for the legs!"],
    muse: ["Hup! Hup!", "Feel the burn!"],
  },
  normal: {
    greet: ["Oh, hello! Lovely day, isn't it?", "Hi there! Nice to see you."],
    talk: ["I like watching people meet up here.", "The planters smell lovely this time of day.", "Have you tried the sunset? Open the Menu and pick it."],
    muse: ["What a peaceful day.", "I should water the plants."],
  },
  snooty: {
    greet: ["Oh. Hello, darling.", "Ah, a visitor. How quaint."],
    talk: ["The anthuriums here are acceptable, I suppose.", "One must dress for the beach, darling.", "I only stand where the light is flattering."],
    muse: ["Hmm, simply divine.", "Where is my sun hat..."],
  },
};

/** What two residents say to each other, alternating. */
export const CHATTER: readonly string[] = [
  "Did you see the new app at the exhibits?",
  "The waves are big today!",
  "I love this time of day.",
  "Want to go to the beach later?",
  "Nagi said someone new arrived!",
  "I tried jumping onto the fountain again.",
  "The planters look great, don't they?",
  "Have you been to the water's edge?",
  "Let's sit on the bench for a bit.",
  "I heard the sunset is amazing here.",
];
