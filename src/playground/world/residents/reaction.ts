import type { Personality } from "../../guide/residents";

const THANKS: Record<Personality, string> = {
  lazy: "Aww, thanks... that woke me up!",
  peppy: "You're the best! Right back at you!",
  cranky: "Heh. Thanks, kid.",
  smug: "Excellent taste. Much appreciated!",
  sisterly: "Thanks! I've got your back too.",
  jock: "Yes! That's the spirit!",
  normal: "Thank you. You made my day.",
  snooty: "How lovely of you, darling.",
};

export function residentReaction(personality: Personality, emoji: string): string | null {
  if (!["👋", "❤️", "😂", "👍"].includes(emoji)) return null;
  const greeting = emoji === "👋" ? "Hello again! " : emoji === "😂" ? "Haha! " : "";
  return `${emoji} ${greeting}${THANKS[personality]}`;
}
