import { describe, it, expect, vi } from "vitest";
import { JevProvider, validateJudgment, ProviderError } from "./provider";
import {
  SPAWN,
  candidatesFor,
  decisionProjection,
} from "../../src/playground/coop/adapter";
const observation = {
  instruction: "ここで待って",
  requester: "synthetic",
  self: SPAWN,
  peers: [],
  now: 0,
};
const candidates = candidatesFor(observation),
  state = decisionProjection(observation, candidates);
const response = () => ({
  model: "jev-1.13.0",
  answers: {
    selection: {
      type: "choice",
      choice: "wait",
      confidence: 0.8,
      probabilities: {
        no_action: 0.05,
        clarify: 0.05,
        wait: 0.8,
        entrance: 0.1,
      },
    },
  },
  usage: { input_tokens: 120, output_tokens: 8 },
});
describe("Jev boundary (mocked transport, not a live Jev acceptance)", () => {
  it("rejects out-of-catalog choices, non-finite and incomplete distributions", () => {
    expect(validateJudgment(response(), candidates, 12).candidateId).toBe(
      "wait",
    );
    const unknown = response();
    unknown.answers.selection.choice = "teleport";
    expect(() => validateJudgment(unknown, candidates, 12)).toThrow(
      ProviderError,
    );
    const invalid = response();
    invalid.answers.selection.probabilities.wait = NaN;
    expect(() => validateJudgment(invalid, candidates, 12)).toThrow(
      ProviderError,
    );
    const incomplete = response();
    delete (incomplete.answers.selection.probabilities as any).entrance;
    expect(() => validateJudgment(incomplete, candidates, 12)).toThrow(
      ProviderError,
    );
  });
  it("limits calls, makes no fallback/retry and never exposes raw SDK errors", async () => {
    const provider = new JevProvider("synthetic-key", "jev-latest", 1);
    const call = vi
      .spyOn(provider.client, "systemOne")
      .mockRejectedValue({ status: 429, body: "sensitive request body" });
    await expect(
      provider.decide(state, candidates, new AbortController().signal),
    ).rejects.toMatchObject({ code: "provider_unavailable", status: 429 });
    await expect(
      provider.decide(state, candidates, new AbortController().signal),
    ).rejects.toMatchObject({ code: "budget_exhausted" });
    expect(call).toHaveBeenCalledTimes(1);
  });
  it("discards a late successful response after abort", async () => {
    const provider = new JevProvider("synthetic-key", "jev-latest");
    let finish: (value: any) => void = () => {};
    vi.spyOn(provider.client, "systemOne").mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }) as ReturnType<typeof provider.client.systemOne>,
    );
    const abort = new AbortController(),
      pending = provider.decide(state, candidates, abort.signal);
    abort.abort(new Error("stopped"));
    finish(response());
    await expect(pending).rejects.toThrow("stopped");
  });
});
