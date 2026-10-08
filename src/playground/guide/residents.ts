/**
 * Plaza's ten residents as characters: who they are and how they talk.
 *
 * Shared by the scene (world/residents) and the conversation API (bundled
 * into plaza-guide.generated.js), so a resident's canned lines and the
 * persona the model is given never drift apart. Pure data: no three.js.
 */

export type Species =
  | "cat" | "dog" | "panda" | "fox" | "penguin"
  | "rabbit" | "bear" | "koala" | "frog" | "owl";

export type Personality =
  | "lazy" | "peppy" | "cranky" | "smug" | "sisterly" | "jock" | "normal" | "snooty";

export type ResidentId =
  | "cat" | "dog" | "panda" | "fox" | "penguin"
  | "rabbit" | "bear" | "koala" | "frog" | "owl";

export interface ResidentProfile {
  id: ResidentId;
  name: string;
  species: Species;
  personality: Personality;
}

export const RESIDENT_PROFILES: readonly ResidentProfile[] = [
  { id: "cat", name: "Calico", species: "cat", personality: "lazy" },
  { id: "dog", name: "Sora", species: "dog", personality: "jock" },
  { id: "panda", name: "Momo", species: "panda", personality: "normal" },
  { id: "fox", name: "Rusty", species: "fox", personality: "smug" },
  { id: "penguin", name: "Pip", species: "penguin", personality: "peppy" },
  { id: "rabbit", name: "Clover", species: "rabbit", personality: "sisterly" },
  { id: "bear", name: "Bruno", species: "bear", personality: "cranky" },
  { id: "koala", name: "Kiki", species: "koala", personality: "snooty" },
  { id: "frog", name: "Lily", species: "frog", personality: "peppy" },
  { id: "owl", name: "Olive", species: "owl", personality: "normal" },
];

export const RESIDENT_BY_ID = new Map(RESIDENT_PROFILES.map((profile) => [profile.id, profile]));

/** How each personality talks, for the model. */
export const PERSONALITY_STYLE: Record<Personality, string> = {
  lazy: "laid-back and sleepy; you love naps, snacks and comfy benches, and you talk slowly",
  peppy: "bubbly and excitable; everything is wonderful and you use exclamation marks",
  cranky: "gruff and curt, a little grumpy, but kind underneath and secretly fond of the sea",
  smug: "polished and self-assured, a touch vain but friendly; you enjoy culture and the exhibits",
  sisterly: "frank and caring, like a big sister; you look out for newcomers",
  jock: "energetic and sporty; you turn everything into exercise and cheer people on",
  normal: "gentle, kind and polite; you enjoy quiet things like plants and people meeting",
  snooty: "refined and a little haughty; you care about style and call people 'darling'",
};

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
