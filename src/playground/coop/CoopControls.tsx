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
  unavailable: "接続待ち",
  ready: "参加待ち",
  running: "参加中",
  paused: "一時停止中",
  ended: "終了",
  degraded: "待機中（接続・判断エラー）",
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
    if (!response.ok) throw new Error("AIの状態を取得できませんでした。");
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
        if (!abort.signal.aborted) setError("AIとの接続を確認できません。");
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
          "操作を確認できませんでした。状態を確認して再操作してください。",
        );
      if (name === "goal") setInstruction("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "接続エラー");
    } finally {
      setBusy(false);
    }
  }
  if (!status?.enabled) return null;
  return (
    <aside
      className="pg-coop"
      aria-label="AIとの共同操作"
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
            開始者：{status.actor.started_by.animal_emoji}{" "}
            {status.actor.started_by.display_name}
          </small>
        )}
        {!status.available && <p>実行プロセスの接続を待っています。</p>}
        {status.available && (
          <fieldset disabled={busy}>
            <legend>この検証Instanceでの同意</legend>
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
              自分の位置・指示をAIが観測する
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
              指示と必要な候補情報をTypeSafeへ送信する
            </label>
            <small>
              部屋の会話履歴は送信しません。同意はいつでも撤回できます。
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
                  AIを参加させる
                </button>
              )}
              {["paused", "degraded"].includes(status.status) && (
                <button
                  disabled={busy || !status.available || !observe || !disclose}
                  onClick={() => void command("resume")}
                >
                  再開
                </button>
              )}
              {status.status === "running" && (
                <button onClick={() => void command("pause")}>一時停止</button>
              )}
              {!["ready", "ended"].includes(status.status) && (
                <button onClick={() => void command("end")}>終了</button>
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
                <label htmlFor="coop-instruction">AIへ指示</label>
                <input
                  id="coop-instruction"
                  value={instruction}
                  maxLength={500}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="近くに来て"
                />
                <button disabled={busy || !instruction.trim()}>送る</button>
              </form>
            )}
            <small>
              最新の指示で置き換えます。上限：10分・30回の判断。使用{" "}
              {status.calls}/30回
            </small>
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </details>
      <details>
        <summary>投稿履歴（{posts.length}）</summary>
        <ol className="pg-coop-history">
          {posts.slice(-30).map((post) => {
            const author = post.author_actor
              ? `${post.author_actor.display_name} · AI`
              : (participants.find(
                  (p) => p.principal_id === post.author_user_id,
                )?.display_name ?? "参加者");
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
