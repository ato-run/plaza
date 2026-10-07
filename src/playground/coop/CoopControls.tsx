import { useEffect, useState } from "react";
import { APP_ROOM_API_PREFIX } from "../roomProtocol";
import type { PlaygroundPost, VerifiedActorMetadata } from "../types";
import type { PresenceMember } from "../presenceStore";
import "./coop.css";

interface Status {
  enabled: boolean;
  available: boolean;
  can_control: boolean;
  status: "unavailable" | "ready" | "running" | "paused" | "ended" | "degraded";
  actor: (VerifiedActorMetadata & { principal_id: string }) | null;
  consent: { observe: boolean; disclose: boolean };
  calls: number;
  reason: string | null;
}
const labels: Record<Status["status"], string> = {
  unavailable: "Waiting to connect",
  ready: "Ready to join",
  running: "In the plaza",
  paused: "Paused",
  ended: "Ended",
  degraded: "Waiting (connection or decision error)",
};
export function CoopControls({
  posts,
  participants,
  onFocusChange,
}: {
  posts: PlaygroundPost[];
  participants: PresenceMember[];
  onFocusChange: (paused: boolean) => void;
}) {
  const [status, setStatus] = useState<Status | null>(null),
    [instruction, setInstruction] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [observe, setObserve] = useState(false),
    [disclose, setDisclose] = useState(false);
  useEffect(() => {
    const leavePanel = (event: PointerEvent) => {
      if (!(event.target as Element).closest(".pg-coop")) {
        if (
          document.activeElement instanceof HTMLElement &&
          document.activeElement.closest(".pg-coop")
        )
          document.activeElement.blur();
        onFocusChange(false);
      }
    };
    window.addEventListener("pointerdown", leavePanel, true);
    return () => window.removeEventListener("pointerdown", leavePanel, true);
  }, [onFocusChange]);
  async function refresh(signal?: AbortSignal) {
    const response = await fetch(`${APP_ROOM_API_PREFIX}/coop/status`, {
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
    if (response.status === 404) {
      setStatus(null);
      return false;
    }
    if (!response.ok) throw new Error("Couldn't get the AI's status.");
    const next = (await response.json()) as Status;
    setStatus(next);
    setObserve(next.consent.observe);
    setDisclose(next.consent.disclose);
    return true;
  }
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    // UI polling only; the Controller and movement execute in the server-side Node process.
    const poll = async () => {
      try {
        if (!(await refresh(abort.signal))) return;
      } catch {
        if (!abort.signal.aborted) setError("Can't reach the AI.");
      }
      if (!abort.signal.aborted) timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, []);
  async function command(name: string, body: unknown = {}) {
    if (name !== "pause" && name !== "end") setBusy(true);
    setError("");
    try {
      const response = await fetch(`${APP_ROOM_API_PREFIX}/coop/${name}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok)
        throw new Error(
          "Couldn't confirm that action. Check the status and try again.",
        );
      if (name === "goal") setInstruction("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection error");
    } finally {
      setBusy(false);
    }
  }
  if (!status?.enabled) return null;
  return (
    <aside
      className="pg-coop"
      aria-label="Play with AI"
      onKeyDown={(e) => e.stopPropagation()}
      onFocus={() => onFocusChange(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          onFocusChange(false);
      }}
    >
      <details open>
        <summary>
          {status.actor?.display_name ?? "Plaza Guide"} · AI{" "}
          <span role="status">{labels[status.status]}</span>
        </summary>
        {status.actor && (
          <small>
            Started by: {status.actor.started_by.animal_emoji}{" "}
            {status.actor.started_by.display_name}
          </small>
        )}
        {!status.available && <p>Waiting for the AI process to connect.</p>}
        {status.available && (
          <fieldset disabled={busy}>
            <legend>Consent for this test instance</legend>
            <label>
              <input
                type="checkbox"
                checked={observe}
                onChange={(e) => {
                  setObserve(e.target.checked);
                  void command("consent", {
                    observe: e.target.checked,
                    disclose: e.target.checked && disclose,
                  });
                }}
              />
              Let the AI see my position and instructions
            </label>
            <label>
              <input
                type="checkbox"
                checked={disclose}
                disabled={!observe}
                onChange={(e) => {
                  setDisclose(e.target.checked);
                  void command("consent", {
                    observe,
                    disclose: e.target.checked,
                  });
                }}
              />
              Send instructions and the options they need to TypeSafe
            </label>
            <small>
              Room chat history is not sent. You can withdraw consent at any time.
            </small>
          </fieldset>
        )}
        {status.can_control && (
          <>
            <div className="pg-coop-actions">
              {["ready", "ended"].includes(status.status) && (
                <button
                  disabled={busy || !status.available || !observe || !disclose}
                  onClick={() => void command("start")}
                >
                  Add AI
                </button>
              )}
              {["paused", "degraded"].includes(status.status) && (
                <button
                  disabled={busy || !status.available || !observe || !disclose}
                  onClick={() => void command("resume")}
                >
                  Resume
                </button>
              )}
              {status.status === "running" && (
                <button onClick={() => void command("pause")}>Pause</button>
              )}
              {!["ready", "ended"].includes(status.status) && (
                <button onClick={() => void command("end")}>End</button>
              )}
            </div>
            {status.status === "running" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (instruction.trim())
                    void command("goal", { instruction: instruction.trim() });
                }}
              >
                <label htmlFor="coop-instruction">Instruction to AI</label>
                <input
                  id="coop-instruction"
                  value={instruction}
                  maxLength={500}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="Come here"
                />
                <button disabled={busy || !instruction.trim()}>Send</button>
              </form>
            )}
            <small>
              Each instruction replaces the last. Limit: 10 minutes, 30 decisions. Used{" "}
              {status.calls}/30
            </small>
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </details>
      <details>
        <summary>Post history ({posts.length})</summary>
        <ol className="pg-coop-history">
          {posts.slice(-30).map((post) => {
            const author = post.author_actor
              ? `${post.author_actor.display_name} · AI`
              : (participants.find(
                  (p) => p.principal_id === post.author_user_id,
                )?.display_name ?? "Participant");
            return (
              <li key={post.id} data-post-id={post.id}>
                <strong>{author}</strong>
                <span>{post.text}</span>
              </li>
            );
          })}
        </ol>
      </details>
    </aside>
  );
}
