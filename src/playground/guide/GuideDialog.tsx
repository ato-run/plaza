/**
 * Talking with Nagi: her line, the choices that follow from it, and a field
 * for asking in your own words. The world pauses while it is open; picking a
 * lesson or a destination closes it and hands you back to the plaza.
 */
import { useEffect, useRef, useState } from "react";

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
  context: GuideContext;
  /** Where the conversation starts this time (greeting on a first talk). */
  start: GuideReply;
  onAction(action: GuideAction): void;
  onClose(): void;
}

export function GuideDialog({ open, context, start, onAction, onClose }: GuideDialogProps) {
  const [current, setCurrent] = useState<GuideReply>(start);
  const [asked, setAsked] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setCurrent(start);
    setAsked(null);
    setDraft("");
    panelRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const choose = (action: GuideAction, label: string | null) => {
    setAsked(label);
    if (action.kind === "node") {
      setCurrent(reply(action.node, context));
      return;
    }
    if (action.kind === "place") {
      const place = PLACE_BY_ID.get(action.place);
      if (place) setCurrent(departure(place));
      return;
    }
    // Lessons, journeys, the menu and goodbye leave the conversation.
    onAction(action);
  };

  const ask = (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    const intent = understand(text);
    if ("place" in intent) {
      choose({ kind: "place", place: intent.place }, text);
    } else {
      choose({ kind: "node", node: intent.node }, text);
    }
  };

  return (
    <div
      ref={panelRef}
      className="pg-guide"
      role="dialog"
      aria-label="Talk with Nagi"
      tabIndex={-1}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") onClose();
      }}
    >
      <header className="pg-guide-head">
        <span className="pg-guide-avatar" aria-hidden="true">
          👒
        </span>
        <div>
          <strong>Nagi</strong>
          <small>Guide</small>
        </div>
        <button type="button" className="pg-menu-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>
      {asked ? <p className="pg-guide-asked">{asked}</p> : null}
      <p className="pg-guide-line" aria-live="polite">
        {current.text}
      </p>
      <div className="pg-guide-choices">
        {current.choices.map((choice) => (
          <button key={choice.label} type="button" onClick={() => choose(choice.action, choice.label)}>
            {choice.label}
          </button>
        ))}
      </div>
      <form className="pg-guide-ask" onSubmit={ask}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask anything (e.g. What can I do here?)"
          aria-label="Ask Nagi"
          maxLength={80}
        />
        <button type="submit" disabled={!draft.trim()}>
          Ask
        </button>
      </form>
    </div>
  );
}

