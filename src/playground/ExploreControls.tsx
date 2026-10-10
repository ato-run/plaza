import { useRef, useState } from "react";
import type { ExploreStatus } from "./world/openAir/scene";
import { ITEM_BY_ID } from "./world/openAir/model";
import { discoveryTitle } from "./world/openAir/notebook";
interface Props {
  status: ExploreStatus | null;
  hidden: boolean;
  onUse(throwing: boolean): void;
  onCharge(on: boolean): void;
  onCancelCharge(): void;
  onRotate(): void;
  onMark(): void;
  onStopEscort(): void;
}
export function ExploreControls({
  status,
  hidden,
  onUse,
  onCharge,
  onCancelCharge,
  onRotate,
  onMark,
  onStopEscort,
}: Props) {
  const [journal, setJournal] = useState(false);
  const throwTouch = useRef<number | null>(null);
  if (hidden || !status) return null;
  const item = status.held ? ITEM_BY_ID.get(status.held) : null;
  const variant = item ? [...ITEM_BY_ID.keys()].indexOf(item.id) % 4 : 0;
  const color =
    item?.kind === "shell"
      ? ["#ffe3bf", "#e9bba4", "#dcd6c5", "#f2d699"][variant]
      : item?.kind === "leaf"
        ? "#b2af57"
        : item?.kind === "wood"
          ? "#95724e"
          : item?.kind === "stone"
            ? "#8c928b"
            : "#d78568";
  const press = (action: () => void) => ({
    onTouchStart: (event: React.TouchEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      action();
    },
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.pointerType === "touch") return;
      event.preventDefault();
      event.stopPropagation();
      action();
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if ((event.key === "Enter" || event.key === " ") && !event.repeat) {
        event.preventDefault();
        action();
      }
    },
  });
  return (
    <>
      {status.notice || status.seated || status.pending ? (
        <div className="pg-explore-note" role="status">
          {status.pending
            ? "Saving action…"
            : status.seated
              ? "Seated. Move or jump to stand."
              : status.notice}
        </div>
      ) : null}
      <button
        className="pg-journal-toggle"
        aria-expanded={journal}
        onClick={() => setJournal((v) => !v)}
        aria-label="Discovery journal"
      >
        ◈
      </button>
      <div className="pg-explore-tools">
        {item ? (
          <>
            <span className="pg-held" aria-label={`Holding ${item.kind}`}>
              <svg
                viewBox="0 0 44 32"
                width="36"
                height="28"
                aria-hidden="true"
              >
                <ellipse
                  cx="22"
                  cy="16"
                  rx={
                    item.kind === "wood" ? 19 : item.kind === "ball" ? 11 : 15
                  }
                  ry={item.kind === "wood" ? 5 : item.kind === "ball" ? 11 : 8}
                  fill={color}
                  stroke="#695c47"
                />
                {item.kind === "shell"
                  ? [12, 18, 24, 30].map((x) => (
                      <path
                        key={x}
                        d={`M22 22 Q${x} 12 ${x} 9`}
                        fill="none"
                        stroke="#a78b75"
                      />
                    ))
                  : null}
              </svg>
              {item.kind}
            </span>
            <button disabled={status.pending} {...press(() => onUse(false))}>
              Place
            </button>
            <button
              disabled={status.pending}
              onTouchStart={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (throwTouch.current === null) {
                  throwTouch.current = event.changedTouches[0].identifier;
                  onCharge(true);
                }
              }}
              onTouchEnd={(event) => {
                event.preventDefault();
                if (
                  Array.from(event.changedTouches).some(
                    (t) => t.identifier === throwTouch.current,
                  )
                ) {
                  throwTouch.current = null;
                  onCharge(false);
                }
              }}
              onTouchCancel={(event) => {
                if (
                  Array.from(event.changedTouches).some(
                    (t) => t.identifier === throwTouch.current,
                  )
                ) {
                  throwTouch.current = null;
                  onCancelCharge();
                }
              }}
              onPointerDown={(event) => {
                if (event.pointerType === "touch") return;
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                onCharge(true);
              }}
              onPointerUp={(event) => {
                if (event.pointerType === "touch") return;
                event.preventDefault();
                event.stopPropagation();
                onCharge(false);
              }}
              onPointerCancel={(event) => {
                if (event.pointerType !== "touch") onCancelCharge();
              }}
              onKeyDown={(event) => {
                if (
                  (event.key === "Enter" || event.key === " ") &&
                  !event.repeat
                ) {
                  event.preventDefault();
                  onCharge(true);
                }
              }}
              onKeyUp={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onCharge(false);
                }
              }}
              aria-label="Hold to aim, release to throw"
            >
              Throw {status.charge ? `${Math.round(status.charge * 100)}%` : ""}
            </button>
            <button {...press(onRotate)} aria-label="Rotate held object">
              ↻
            </button>
          </>
        ) : (
          <button {...press(onMark)}>Draw in sand</button>
        )}
        {status.companion ? (
          <div className="pg-companion">
            <span>
              {status.companion.name}:{" "}
              {status.companion.phase === "waiting"
                ? "waiting for you"
                : status.companion.phase === "arrived"
                  ? `at ${status.companion.goal}`
                  : `walking to ${status.companion.goal}`}
            </span>
            <button {...press(onStopEscort)}>Say goodbye</button>
          </div>
        ) : null}
      </div>
      {journal ? (
        <section className="pg-journal" aria-label="Discovery journal">
          <header>
            <strong>Discoveries</strong>
            <button
              onClick={() => setJournal(false)}
              aria-label="Close journal"
            >
              ✕
            </button>
          </header>
          <p>
            {status.moment.phase} · {status.moment.weather} ·{" "}
            {status.moment.tideDirection} tide
          </p>
          {status.lighting ? (
            <p>
              Personal lighting: {status.lighting}. Shared time above controls
              the tide and neighbors.
            </p>
          ) : null}
          {status.observations.length ? (
            <ul>
              {status.observations.map((id) => (
                <li key={id}>{discoveryTitle(id)}</li>
              ))}
            </ul>
          ) : (
            <p>Try the fountain, tide pools and beach camp.</p>
          )}
          {status.hint ? <p>{status.hint}</p> : null}
          {status.memories.length ? (
            <ul>
              {status.memories.map((entry, i) => (
                <li key={i}>{entry}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
