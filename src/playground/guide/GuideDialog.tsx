/**
 * Talking with someone in Plaza — Nagi or one of the residents: their line,
 * the choices that follow from it, and a field for saying something in your
 * own words. The world pauses while it is open; picking a lesson or a
 * destination closes it and hands you back to the plaza.
 */
import { useEffect, useRef, useState } from "react";

import { askNpc, endNpcConversation, NpcChatError, newId } from "./chatClient";
import { npcFallback, type NpcProfile } from "./knowledge";
import {
  departure,
  PLACE_BY_ID,
  reply,
  understand,
  type GuideAction,
  type GuideContext,
  type GuideReply,
} from "./nagi";

interface GuideDialogProps {
  open: boolean;
  /** Who you are talking to. */
  npc: NpcProfile;
  context: GuideContext;
  /** Where the conversation starts this time (greeting on a first talk). */
  start: GuideReply;
  onAction(action: GuideAction): void;
  onClose(): void;
  /**
   * Answer free text with the NPC conversation API, which uses the model
   * for signed-in visitors and the rule-based answer for everyone else; when
   * the API is unreachable (local dev), the page answers by rule itself.
   */
  useModel: boolean;
  waitingForClaim?: boolean;
  sharedApps?: readonly { ref: string; title: string }[];
  onTryApp?(ref: string): void;
  onDiscussApp?(ref: string): void;
  heldItem?: string | null;
  onDeliver?(): void;
  onEscort?(goal: "pools" | "camp" | "pier" | "lookout"): void;
  memories?: string[];
}

export function GuideDialog({
  open,
  npc,
  context,
  start,
  onAction,
  onClose,
  useModel,
  onEscort,
  onDeliver,
  heldItem,
  sharedApps = [],
  onTryApp,
  onDiscussApp,
  waitingForClaim = false,
  memories = [],
}: GuideDialogProps) {
  const [current, setCurrent] = useState<GuideReply>(start);
  const [asked, setAsked] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  // One server conversation per opening of the dialog; ended when it closes.
  const conversationRef = useRef<{
    id: string;
    npcId: NpcProfile["id"];
    used: boolean;
  } | null>(null);
  const pendingRef = useRef<AbortController | null>(null);

  const endConversation = () => {
    pendingRef.current?.abort();
    pendingRef.current = null;
    setThinking(false);
    const conversation = conversationRef.current;
    conversationRef.current = null;
    if (conversation?.used)
      endNpcConversation(conversation.npcId, conversation.id);
  };

  useEffect(() => {
    if (!open) {
      endConversation();
      return;
    }
    endConversation();
    conversationRef.current = { id: newId("conv"), npcId: npc.id, used: false };
    setCurrent(start);
    setAsked(null);
    setDraft("");
    panelRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, npc.id]);

  // Leaving the page mid-conversation still closes it server-side.
  useEffect(() => () => endConversation(), []);

  // Esc closes from anywhere: while waiting the field is disabled and focus
  // may have left the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const choose = (action: GuideAction, label: string | null) => {
    setAsked(label);
    if (action.kind === "node") {
      setCurrent(reply(action.node, context));
      return;
    }
    if (action.kind === "place") {
      if (action.place === "exhibits" && context.exhibits === 0) {
        setCurrent({
          text: "There are no app displays right now. Share an app link in Talk, or explore the tide pools.",
          choices: [
            {
              label: "Explore the tide pools",
              action: { kind: "place", place: "pools" },
            },
          ],
        });
        return;
      }
      const place = PLACE_BY_ID.get(action.place);
      if (place) setCurrent(departure(place));
      return;
    }
    // Lessons, journeys, the menu and goodbye leave the conversation.
    onAction(action);
  };

  const answerLocally = (text: string) => {
    if (npc.id !== "nagi") {
      setAsked(text);
      setCurrent(npcFallback(npc.id, text, context));
      return;
    }
    const intent = understand(text);
    if ("place" in intent) {
      choose({ kind: "place", place: intent.place }, text);
    } else {
      choose({ kind: "node", node: intent.node }, text);
    }
  };

  const ask = (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim().slice(0, 400);
    if (!text || thinking || waitingForClaim) return;
    setDraft("");
    const conversation = conversationRef.current;
    if (!useModel || !conversation) {
      answerLocally(text);
      return;
    }
    conversation.used = true;
    const controller = new AbortController();
    pendingRef.current = controller;
    setAsked(text);
    setThinking(true);
    panelRef.current?.focus();
    askNpc({
      npcId: npc.id,
      conversationId: conversation.id,
      requestId: newId("req"),
      message: text,
      context,
      signal: controller.signal,
    })
      .then((answer) => {
        // A reply to a conversation already closed or cancelled is dropped.
        if (
          pendingRef.current !== controller ||
          conversationRef.current !== conversation
        )
          return;
        setCurrent({ text: answer.text, choices: answer.choices });
      })
      .catch((error: unknown) => {
        if (
          pendingRef.current !== controller ||
          conversationRef.current !== conversation
        )
          return;
        // A closed or foreign conversation id: start a fresh one next time.
        if (error instanceof NpcChatError && /conversation_/.test(error.code)) {
          endConversation();
          conversationRef.current = {
            id: newId("conv"),
            npcId: npc.id,
            used: false,
          };
        }
        answerLocally(text);
      })
      .finally(() => {
        if (pendingRef.current === controller) {
          pendingRef.current = null;
          setThinking(false);
        }
      });
  };

  const cancel = () => {
    pendingRef.current?.abort();
    pendingRef.current = null;
    setThinking(false);
  };

  return (
    <div
      ref={panelRef}
      className="pg-guide"
      role="dialog"
      aria-label={`Talk with ${npc.name}`}
      tabIndex={-1}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") onClose();
      }}
    >
      <header className="pg-guide-head">
        <span className="pg-guide-avatar" aria-hidden="true">
          {npc.avatar}
        </span>
        <div>
          <strong>{npc.name}</strong>
          <small>{npc.role}</small>
        </div>
        <button
          type="button"
          className="pg-menu-close"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
      </header>
      {memories.some((entry) => entry.startsWith(`${npc.id}:`)) ? (
        <p className="pg-guide-memory">
          We met earlier:{" "}
          {memories
            .filter((entry) => entry.startsWith(`${npc.id}:`))
            .slice(-1)[0]
            ?.split(": ")
            .slice(1)
            .join(": ")}
        </p>
      ) : null}
      {waitingForClaim ? <p role="status">Waiting for this neighbor…</p> : null}
      {asked ? <p className="pg-guide-asked">{asked}</p> : null}
      <p className="pg-guide-line" aria-live="polite">
        {thinking ? (
          <span className="pg-guide-thinking">
            {npc.name} is thinking<span aria-hidden="true">…</span>
          </span>
        ) : (
          current.text
        )}
      </p>
      {thinking ? (
        <div className="pg-guide-choices">
          <button type="button" onClick={cancel}>
            Cancel
          </button>
        </div>
      ) : null}
      <div className="pg-guide-choices" hidden={thinking}>
        {current.choices.map((choice) => (
          <button
            key={choice.label}
            type="button"
            onClick={() => choose(choice.action, choice.label)}
          >
            {choice.label}
          </button>
        ))}
      </div>
      {npc.id === "owl" && heldItem === "keepsake" && onDeliver ? (
        <button className="pg-guide-choice" onClick={onDeliver}>
          Return your lost shell
        </button>
      ) : null}
      {sharedApps.length ? (
        <details className="pg-escort">
          <summary>Apps on display</summary>
          {sharedApps.slice(0, 2).map((app) => (
            <div className="pg-guide-choices" key={app.ref}>
              <span>{app.title}</span>
              <button onClick={() => onTryApp?.(app.ref)}>Try it</button>
              <button onClick={() => onDiscussApp?.(app.ref)}>
                Talk about this app
              </button>
            </div>
          ))}
        </details>
      ) : null}
      {onEscort && npc.id !== "nagi" ? (
        <details className="pg-escort">
          <summary>Explore together</summary>
          <div className="pg-guide-choices">
            <button
              disabled={waitingForClaim}
              onClick={() => onEscort("pools")}
            >
              Find shells at the tide pools
            </button>
            <button disabled={waitingForClaim} onClick={() => onEscort("pier")}>
              Float driftwood at the pier
            </button>
            <button disabled={waitingForClaim} onClick={() => onEscort("camp")}>
              Watch the sky at camp
            </button>
            <button
              disabled={waitingForClaim}
              onClick={() => onEscort("lookout")}
            >
              Climb the dune lookout
            </button>
          </div>
        </details>
      ) : null}
      <form className="pg-guide-ask" onSubmit={ask}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={
            npc.id === "nagi"
              ? "Ask anything (e.g. What can I do here?)"
              : `Talk to ${npc.name}…`
          }
          aria-label={`Say something to ${npc.name}`}
          maxLength={400}
          disabled={thinking || waitingForClaim}
        />
        <button type="submit" disabled={!draft.trim() || thinking}>
          Send
        </button>
      </form>
    </div>
  );
}
