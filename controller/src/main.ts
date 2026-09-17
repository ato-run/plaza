import { ControllerTransport } from "./transport";
import { runController } from "./daemon";
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
await runController(transport, {
  async decide(state, candidates, signal) {
    if (await modelReady) throw new ProviderError("provider_unavailable");
    return provider.decide(state, candidates, signal);
  },
});
