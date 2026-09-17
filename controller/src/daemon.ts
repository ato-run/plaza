import { ControllerTransport } from "./transport";
import { PlazaControllerLoop } from "./loop";
import type { SystemOneProvider } from "./provider";

/** One process/Actor lifecycle, shared by the real provider and test-only scripted entry. */
export async function runController(
  transport: ControllerTransport,
  provider: SystemOneProvider,
) {
  const loop = new PlazaControllerLoop(transport, provider, (entry) =>
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
}
