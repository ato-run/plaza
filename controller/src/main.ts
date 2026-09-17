import { ControllerTransport } from "./transport";
import { PlazaControllerLoop } from "./loop";
import { JevProvider, ProviderError } from "./provider";

const key = process.env.JEV_API_KEY ?? process.env.TYPESAFE_API_KEY;
const token = process.env.ATO_CONTROLLER_SESSION_TOKEN;
const origin = process.env.ATO_API_ORIGIN;
if (!key || !token || !origin)
  throw new Error(
    "JEV_API_KEY_ATO_CONTROLLER_SESSION_TOKEN_ATO_API_ORIGIN_required",
  );
const provider = new JevProvider(key, process.env.JEV_MODEL ?? "jev-latest");
const modelReady = provider.verifyModel().then(
  () => null,
  () => "provider_unavailable" as const,
);
const transport = new ControllerTransport(origin, token);
// Structured diagnostics contain identifiers/distributions/usage only, never goal text or HTTP bodies.
const loop = new PlazaControllerLoop(
  transport,
  {
    async decide(state, candidates, signal) {
      if (await modelReady) throw new ProviderError("provider_unavailable");
      return provider.decide(state, candidates, signal);
    },
  },
  (entry) =>
    console.log(JSON.stringify({ at: new Date().toISOString(), ...entry })),
);
await transport.register();
let stopped = false,
  heartbeatRunning = false;
const stop = () => {
  stopped = true;
  loop.stop();
  clearInterval(heartbeat);
  clearInterval(tick);
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
const heartbeat = setInterval(async () => {
  if (stopped || heartbeatRunning) return;
  heartbeatRunning = true;
  try {
    await transport.heartbeat();
    void loop.decide();
  } catch {
    console.error(
      JSON.stringify({ phase: "stopped", reason: "heartbeat_failed" }),
    );
    stop();
  } finally {
    heartbeatRunning = false;
  }
}, 1000);
const tick = setInterval(() => {
  if (!stopped) void loop.tick();
}, 100);
console.log(
  JSON.stringify({
    phase: "ready",
    instance_id: transport.control?.instance_id,
    actor_id: transport.control?.actor_id,
  }),
);
