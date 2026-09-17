/** Local acceptance only. Never selected as an automatic provider fallback. */
import { ControllerTransport } from "./transport";
import { runController } from "./daemon";
if (process.env.PLAZA_CONTROLLER_TEST_MODE !== "scripted")
  throw new Error("test_mode_required");
const origin = process.env.ATO_API_ORIGIN!;
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname))
  throw new Error("local_test_only");
await runController(
  new ControllerTransport(origin, process.env.ATO_CONTROLLER_SESSION_TOKEN!),
  {
    async decide(state, candidates, signal) {
      const text = String((state as { instruction?: string }).instruction);
      const action = text.includes("待って")
        ? "wait"
        : text.includes("振って")
          ? "react"
          : text.includes("ついて")
            ? "follow"
            : "move_to";
      const chosen =
        candidates.find(
          (c) =>
            c.action === action &&
            (!c.target || c.description.includes("指示者")),
        ) ?? candidates.find((c) => c.id === "clarify")!;
      await new Promise((resolve) => setTimeout(resolve, 600));
      signal.throwIfAborted();
      return {
        candidateId: chosen.id,
        model: "scripted-test-only",
        confidence: 1,
        probabilities: Object.fromEntries(
          candidates.map((c) => [c.id, c.id === chosen.id ? 1 : 0]),
        ),
        latencyMs: 600,
        usage: { input_tokens: 0, output_tokens: 0 },
        estimatedUsd: 0,
      };
    },
  },
);
