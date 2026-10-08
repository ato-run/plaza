import { useState } from "react";
import type { ExploreStatus } from "./world/openAir/scene";
import { ITEM_BY_ID } from "./world/openAir/model";
interface Props {
  status: ExploreStatus | null;
  hidden: boolean;
  onUse(throwing: boolean): void;
}
export function ExploreControls({ status, hidden, onUse }: Props) {
  const [journal, setJournal] = useState(false);
  if (hidden || !status) return null;
  const item = status.held ? ITEM_BY_ID.get(status.held) : null;
  return (
    <>
      {status.seated ? (
        <div className="pg-explore-note" role="status">
          Seated. Move or jump to stand.
        </div>
      ) : status.notice ? (
        <div className="pg-explore-note" role="status">
          {status.notice}
        </div>
      ) : null}
      <div className="pg-explore-tools">
        {item ? (
          <>
            <span>Holding {item.kind}</span>
            <button onClick={() => onUse(false)}>
              Place <kbd>Q</kbd>
            </button>
            <button onClick={() => onUse(true)}>
              Throw <kbd>F</kbd>
            </button>
          </>
        ) : null}
        <button
          aria-expanded={journal}
          onClick={() => setJournal((v) => !v)}
          aria-label="Discovery journal"
        >
          ◈
        </button>
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
            {status.moment.tide < 0 ? "low tide" : "rising tide"}
          </p>
          {status.observations.length ? (
            <ul>
              {status.observations.map((id) => (
                <li key={id}>{id.replace("keepsake", "Olive’s lost shell")}</li>
              ))}
            </ul>
          ) : (
            <p>Try the fountain, tide pools and beach camp.</p>
          )}
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
