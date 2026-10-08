/**
 * The page's side of the NPC conversation API (same origin, on the
 * Instance host). The server decides who you are, what each character knows
 * and which model answers; this only sends who you are talking to, your
 * words and display hints, and hands back a validated reply.
 */
import type { NpcId } from "./knowledge";
import type { GuideChoice, GuideContext } from "./nagi";

export const NPC_CHAT_PATH = "/__ato/app-room/npc/chat";
export const NPC_END_PATH = "/__ato/app-room/npc/end";
const CLIENT_TIMEOUT_MS = 20_000;

export interface NpcChatReply {
  conversationId: string;
  requestId: string;
  text: string;
  choices: GuideChoice[];
  mode: "llm" | "fallback";
}

export class NpcChatError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export function newId(prefix: string): string {
  const random = crypto.getRandomValues(new Uint8Array(12));
  return `${prefix}_${Array.from(random, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function isReply(value: unknown): value is NpcChatReply {
  if (!value || typeof value !== "object") return false;
  const reply = value as Record<string, unknown>;
  return (
    typeof reply.text === "string" &&
    reply.text.length > 0 &&
    Array.isArray(reply.choices) &&
    reply.choices.every(
      (choice) =>
        choice &&
        typeof (choice as GuideChoice).label === "string" &&
        typeof (choice as GuideChoice).action?.kind === "string",
    ) &&
    (reply.mode === "llm" || reply.mode === "fallback")
  );
}

export async function askNpc(input: {
  npcId: NpcId;
  conversationId: string;
  requestId: string;
  message: string;
  context: GuideContext;
  signal: AbortSignal;
}): Promise<NpcChatReply> {
  const timeout = AbortSignal.timeout(CLIENT_TIMEOUT_MS);
  const signal = AbortSignal.any([input.signal, timeout]);
  const response = await fetch(NPC_CHAT_PATH, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    signal,
    body: JSON.stringify({
      npcId: input.npcId,
      conversationId: input.conversationId,
      requestId: input.requestId,
      message: input.message,
      hints: {
        touch: input.context.touch,
        lookMode: input.context.lookMode,
        engaged: input.context.engaged,
        peopleNearby: input.context.peopleNearby,
        exhibits: input.context.exhibits,
      },
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new NpcChatError((body as { error?: string } | null)?.error ?? `http_${response.status}`);
  if (!isReply(body)) throw new NpcChatError("invalid_reply");
  return body;
}

/** Close the conversation server-side; best effort, never awaited by the UI. */
export function endNpcConversation(npcId: NpcId, conversationId: string): void {
  try {
    void fetch(NPC_END_PATH, {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ npcId, conversationId }),
    }).catch(() => {});
  } catch {
    // Expiry (15 minutes) cleans up whatever this misses.
  }
}
