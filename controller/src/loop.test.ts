import { it, expect, vi, afterEach } from "vitest";
import { PlazaControllerLoop } from "./loop";
import { ControllerTransport, type Control } from "./transport";
import type { Judgment, SystemOneProvider } from "./provider";
import { ADAPTER_ID, WORLD } from "../../src/playground/coop/adapter";
function fixture() {
  const transport = new ControllerTransport(
    "http://localhost:8787",
    "synthetic",
  );
  const c: Control = {
    instance_id: "instance",
    activity_id: "activity",
    actor_id: "ai",
    actor_run_id: "actor-run",
    application_run_id: "app-run",
    adapter_id: ADAPTER_ID,
    scope: WORLD,
    status: "running",
    reason: null,
    fence: {
      session_id: "session",
      session_epoch: 1,
      execution_epoch: 1,
      goal_revision: 1,
      room_epoch: 0,
      executor_id: transport.executorId,
    },
    durable_cursor: 0,
    observed_at: Date.now(),
    live_version: 0,
    goal: {
      instruction: "ここで待って",
      principalId: "a",
      receivedAt: Date.now(),
    },
    peers: [],
    deadline: Date.now() + 60000,
    calls: 0,
    lease_expires_at: Date.now() + 5000,
  };
  transport.control = c;
  return { transport, c };
}
afterEach(() => vi.restoreAllMocks());
it("does not apply a late judgment after direct stop, even if the provider ignores abort", async () => {
  const { transport, c } = fixture();
  vi.spyOn(transport, "connect").mockResolvedValue();
  vi.spyOn(transport, "ephemeral").mockResolvedValue();
  vi.spyOn(transport, "reserve").mockResolvedValue(c);
  const post = vi.spyOn(transport, "post"),
    degraded = vi.spyOn(transport, "degraded");
  let finish: (result: Judgment) => void = () => {};
  const provider: SystemOneProvider = {
    decide: vi.fn(
      () =>
        new Promise<Judgment>((resolve) => {
          finish = resolve;
        }),
    ),
  };
  const loop = new PlazaControllerLoop(transport, provider);
  await loop.tick();
  const pending = loop.decide();
  await Promise.resolve();
  const stopped = {
    ...c,
    status: "paused" as const,
    fence: { ...c.fence, execution_epoch: 2, goal_revision: 2 },
  };
  transport.control = stopped;
  transport.onControl(stopped);
  finish({
    candidateId: "wait",
    confidence: 1,
    probabilities: { wait: 1 },
    model: "mock",
    latencyMs: 1,
    usage: { input_tokens: 0, output_tokens: 0 },
    estimatedUsd: 0,
  });
  await pending;
  expect(post).not.toHaveBeenCalled();
  expect(degraded).not.toHaveBeenCalled();
  await loop.decide();
  expect(provider.decide).toHaveBeenCalledTimes(1);
});

it("paces movement from the applied ACK and ignores errors from a replaced goal", async () => {
  const { transport, c } = fixture();
  let clock = 1000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  c.deadline = 100000;
  c.observed_at = clock;
  c.peers = [
    {
      principal_id: "a",
      display_name: "A",
      scope: WORLD,
      pose: {
        x: 2,
        y: 1.65,
        z: 18,
        yaw: 0,
        pitch: 0,
        pose: "stand",
        movement: "idle",
      },
      observed_at: clock,
      consent: true,
    },
  ];
  vi.spyOn(transport, "connect").mockResolvedValue();
  const ephemeral = vi
    .spyOn(transport, "ephemeral")
    .mockImplementation(async () => {
      clock += 80;
    });
  vi.spyOn(transport, "reserve").mockResolvedValue(c);
  vi.spyOn(transport, "post").mockResolvedValue({
    status: "room-committed",
    seq: 1,
    actor_id: "actor:ai",
  });
  const degraded = vi.spyOn(transport, "degraded").mockResolvedValue();
  const provider: SystemOneProvider = {
    decide: async () => ({
      candidateId: "follow_0",
      model: "mock",
      confidence: 1,
      probabilities: { follow_0: 1 },
      latencyMs: 1,
      usage: { input_tokens: 0, output_tokens: 0 },
      estimatedUsd: 0,
    }),
  };
  const loop = new PlazaControllerLoop(transport, provider);
  await loop.tick(); // ACK at 1080, not the 1000 tick start.
  await loop.decide();
  clock = 1150;
  await loop.tick();
  expect(ephemeral).toHaveBeenCalledTimes(1);
  clock = 1200;
  ephemeral.mockImplementationOnce(async () => {
    const newer = {
      ...c,
      fence: { ...c.fence, execution_epoch: 2, goal_revision: 2 },
    };
    transport.control = newer;
    transport.onControl(newer);
    throw new Error("controller_fenced");
  });
  await loop.tick();
  expect(ephemeral).toHaveBeenCalledTimes(2);
  expect(degraded).not.toHaveBeenCalled();
});
