import { createHash } from "node:crypto";
import {
  candidatesFor,
  decisionProjection,
  movementStep,
  navigationPath,
  SPAWN,
  WORLD,
  POSE_MAX_AGE_MS,
  templatePost,
  CANDIDATE_VERSION,
  type Pose,
  type Candidate,
  type TemplateId,
} from "../../src/playground/coop/adapter";
import { sanitizeTransform } from "../../src/playground/world/worldMath";
import {
  ControllerTransport,
  fenceKey,
  type Control,
  type Fence,
} from "./transport";
import {
  ProviderError,
  PROMPT_VERSION,
  type SystemOneProvider,
} from "./provider";

/** Deterministic IDs survive transport ambiguity; a new goal always changes the namespace. */
export function intentId(fence: Fence, stage: string): string {
  const bytes = createHash("sha256")
    .update(`${fenceKey(fence)}:${stage}`)
    .digest();
  bytes[6] = (bytes[6] & 15) | 0x50;
  bytes[8] = (bytes[8] & 63) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export class PlazaControllerLoop {
  private abort: AbortController | null = null;
  private deciding = false;
  private decidedKey = "";
  private observedKey = "";
  private selected: Candidate | null = null;
  private pose: Pose = { ...SPAWN };
  private activeFence: Fence | null = null;
  private lastSend = 0;
  private path: { x: number; z: number }[] = [];
  private target: { x: number; z: number } | null = null;
  private ticking = false;
  private initialized = false;
  constructor(
    private readonly transport: ControllerTransport,
    private readonly provider: SystemOneProvider,
    private readonly diagnostic: (
      entry: Record<string, unknown>,
    ) => void = () => {},
  ) {
    transport.onControl = (c) => this.observe(c);
    transport.onDisconnect = () => {
      this.abort?.abort();
      this.selected = null;
      this.initialized = false;
      this.pose = { ...SPAWN };
    };
  }
  private observe(control: Control) {
    const key = fenceKey(control.fence);
    if (this.observedKey !== key || control.status !== "running") {
      this.abort?.abort();
      this.selected = null;
      this.activeFence = null;
      this.path = [];
      this.target = null;
      this.observedKey = key;
    }
  }
  async decide(): Promise<void> {
    const current = this.transport.control;
    if (
      this.deciding ||
      !this.initialized ||
      !current ||
      current.status !== "running" ||
      !current.goal ||
      Date.now() >= current.deadline
    )
      return;
    const key = fenceKey(current.fence);
    if (key === this.decidedKey) return;
    this.deciding = true;
    this.decidedKey = key;
    const abort = new AbortController();
    this.abort = abort;
    const start = performance.now();
    try {
      const observation = await this.transport.reserve(current.fence);
      if (abort.signal.aborted || fenceKey(observation.fence) !== key) return;
      this.diagnostic({
        phase: "admitted",
        actor_id: observation.actor_id,
        fence: observation.fence,
        durable_cursor: observation.durable_cursor,
        live_version: observation.live_version,
        observed_at: observation.observed_at,
      });
      const obs = {
        instruction: observation.goal!.instruction,
        requester: observation.goal!.principalId,
        self: this.pose,
        peers: observation.peers,
        now: observation.observed_at,
      };
      const candidates = candidatesFor(obs);
      const result = await this.provider.decide(
        decisionProjection(obs, candidates),
        candidates,
        abort.signal,
      );
      const latest = this.transport.control;
      if (
        abort.signal.aborted ||
        !latest ||
        latest.status !== "running" ||
        fenceKey(latest.fence) !== key
      ) {
        this.diagnostic({
          phase: "discarded",
          reason: "fenced",
          actor_id: observation.actor_id,
          fence: observation.fence,
          ...result,
        });
        return;
      }
      const chosen = candidates.find((c) => c.id === result.candidateId);
      if (!chosen) throw new ProviderError("invalid_response");
      this.activeFence = { ...latest.fence };
      this.selected = chosen;
      // Confidence is evidence, never authority. A conservative UX fallback is evaluated separately.
      if (result.confidence < 0.35)
        this.selected = candidates.find((c) => c.id === "clarify")!;
      if (this.selected.target && !this.targetPose(this.selected.target))
        this.selected = candidates.find((c) => c.id === "clarify")!;
      this.diagnostic({
        phase: "selected",
        actor_id: latest.actor_id,
        session_id: latest.fence.session_id,
        fence: latest.fence,
        durable_cursor: observation.durable_cursor,
        live_version: observation.live_version,
        observed_at: observation.observed_at,
        prompt_version: PROMPT_VERSION,
        candidate_version: CANDIDATE_VERSION,
        action_id: intentId(latest.fence, chosen.id),
        selected_candidate: this.selected.id,
        ...result,
      });
      if (this.selected.template)
        await this.post(this.selected.template, "accepted");
      if (
        abort.signal.aborted ||
        fenceKey(this.transport.control!.fence) !== key
      )
        return;
      if (this.selected?.action === "react") {
        await this.transport.ephemeral(
          "plaza.face-reaction",
          { target_principal_id: this.selected.target, emoji: "👋" },
          latest.fence,
        );
        this.selected = null;
      }
      this.diagnostic({
        phase: "action-accepted",
        action_id: intentId(latest.fence, chosen.id),
        latency_ms: performance.now() - start,
      });
    } catch (error) {
      if (!abort.signal.aborted) {
        const reason =
          error instanceof ProviderError ? error.code : "transport_failed";
        this.diagnostic({ phase: "failed", reason });
        await this.transport.degraded(reason, current.fence).catch(() => {});
      }
      this.selected = null;
    } finally {
      this.deciding = false;
    }
  }
  private targetPose(id: string): Pose | null {
    const p = this.transport.control?.peers.find((p) => p.principal_id === id);
    if (
      !p ||
      !p.consent ||
      p.scope !== WORLD ||
      Date.now() - p.observed_at > POSE_MAX_AGE_MS
    )
      return null;
    return sanitizeTransform(p.pose);
  }
  private async post(template: TemplateId, stage: string) {
    const c = this.transport.control,
      f = this.activeFence;
    if (!c || !f || fenceKey(c.fence) !== fenceKey(f)) return;
    const operationId = intentId(f, `post:${stage}`),
      op = templatePost(
        template,
        operationId,
        c.goal?.receivedAt ?? c.observed_at,
      );
    const receipt = await this.transport.post(operationId, op, f);
    this.diagnostic({
      phase: "room-committed",
      operation_id: operationId,
      seq: receipt.seq,
      actor_id: receipt.actor_id,
    });
  }
  async tick(now = Date.now()): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const c = this.transport.control;
      if (!c || c.status !== "running" || now >= c.deadline) return;
      await this.transport.connect();
      if (!this.initialized) {
        await this.transport.ephemeral("plaza.transform", this.pose, c.fence);
        this.initialized = true;
        this.lastSend = now;
        return;
      }
      // Compute only when a frame can be sent, and recheck after every await.
      if (
        now - this.lastSend < 100 ||
        !this.transport.control ||
        fenceKey(this.transport.control.fence) !== fenceKey(c.fence)
      )
        return;
      const f = this.activeFence;
      const before = this.pose;
      if (
        this.selected &&
        f &&
        fenceKey(f) === fenceKey(c.fence) &&
        ["move_to", "follow"].includes(this.selected.action)
      ) {
        const goal = this.selected.target
          ? this.targetPose(this.selected.target)
          : this.selected.waypoint;
        if (!goal) {
          this.selected = null;
          this.pose = { ...this.pose, movement: "idle" };
          await this.transport.ephemeral("plaza.transform", this.pose, f);
          await this.post("unavailable", "target-lost");
          return;
        }
        const distance = Math.hypot(goal.x - this.pose.x, goal.z - this.pose.z);
        if (distance <= 1.6) {
          this.pose = { ...this.pose, movement: "idle" };
          if (this.selected.action === "move_to") {
            this.selected = null;
            await this.post("arrived", "completed");
          }
        } else {
          if (
            !this.target ||
            Math.hypot(goal.x - this.target.x, goal.z - this.target.z) > 0.75 ||
            !this.path.length
          ) {
            this.path = navigationPath(this.pose, goal);
            this.target = { x: goal.x, z: goal.z };
          }
          while (
            this.path.length &&
            Math.hypot(
              this.path[0].x - this.pose.x,
              this.path[0].z - this.pose.z,
            ) < 0.12
          )
            this.path.shift();
          if (this.path[0])
            this.pose = movementStep(
              this.pose,
              this.path[0],
              Math.min(0.1, (now - this.lastSend) / 1000),
            );
          else {
            this.selected = null;
            this.pose = { ...this.pose, movement: "idle" };
            await this.post("unavailable", "blocked");
          }
        }
      } else this.pose = { ...this.pose, movement: "idle" };
      // 10 Hz while moving, 1 Hz stationary; below the shared 15 msg/s/socket budget.
      if (now - this.lastSend >= (this.pose.movement === "walk" ? 100 : 1000)) {
        const proposed = this.pose;
        this.pose = before;
        if (fenceKey(this.transport.control!.fence) !== fenceKey(c.fence))
          return;
        await this.transport.ephemeral("plaza.transform", proposed, c.fence);
        this.pose = proposed;
        this.lastSend = now;
      } else this.pose = before;
    } catch (error) {
      this.selected = null;
      this.diagnostic({
        phase: "apply_failed",
        reason: error instanceof Error ? error.message : "apply_failed",
      });
      const c = this.transport.control;
      if (c?.status === "running")
        await this.transport
          .degraded("transport_failed", c.fence)
          .catch(() => this.stop());
    } finally {
      this.ticking = false;
    }
  }
  stop() {
    this.abort?.abort();
    this.selected = null;
    this.transport.close();
  }
}
