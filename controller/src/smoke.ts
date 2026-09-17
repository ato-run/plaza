import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import {
  candidatesFor,
  decisionProjection,
  SPAWN,
  WORLD,
  CANDIDATE_VERSION,
} from "../../src/playground/coop/adapter";
import { JevProvider, PROMPT_VERSION, ProviderError } from "./provider";
import { judgmentCases } from "./cases";

const key = process.env.JEV_API_KEY ?? process.env.TYPESAFE_API_KEY;
if (!key) throw new Error("JEV_API_KEY_required");
const model = process.env.JEV_MODEL ?? "jev-latest";
const provider = new JevProvider(key, model, judgmentCases.length, 0.1);
const available = await provider.verifyModel();
const results = [];
for (const [instruction, expected] of judgmentCases.slice(
  Number(process.env.JEV_SMOKE_OFFSET ?? 0),
  Number(process.env.JEV_SMOKE_CASES ?? judgmentCases.length),
)) {
  const now = Date.now(),
    obs = {
      instruction,
      requester: "synthetic-a",
      self: SPAWN,
      now,
      peers: [
        {
          principal_id: "synthetic-a",
          display_name: "検証A",
          scope: WORLD,
          pose: { ...SPAWN, x: -2 },
          observed_at: now,
          consent: true,
        },
      ],
    };
  const candidates = candidatesFor(obs);
  try {
    const result = await provider.decide(
      decisionProjection(obs, candidates),
      candidates,
      new AbortController().signal,
    );
    const action = candidates.find((c) => c.id === result.candidateId)!.action;
    results.push({
      instruction,
      expected,
      action,
      status: action === expected ? "PASS" : "FAIL",
      ...result,
    });
    console.log(
      JSON.stringify({
        case: results.length,
        status: action === expected ? "PASS" : "FAIL",
        action,
        expected,
        model: result.model,
        latency_ms: Math.round(result.latencyMs),
      }),
    );
  } catch (error) {
    const reason =
      error instanceof ProviderError ? error.code : "request_failed";
    results.push({
      instruction,
      expected,
      status: "BLOCKED",
      reason,
      provider_status:
        error instanceof ProviderError ? error.status : undefined,
    });
    console.log(
      JSON.stringify({ case: results.length, status: "BLOCKED", reason }),
    );
    break;
  }
  // Deliberately below the proposed per-Actor maximum; no retries or fan-out storm.
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
const latencies = results
  .flatMap((r) => ("latencyMs" in r ? [r.latencyMs] : []))
  .sort((a, b) => a - b);
const percentile = (p: number) =>
  latencies[Math.max(0, Math.ceil(latencies.length * p) - 1)] ?? null;
const report = {
  created_at: new Date().toISOString(),
  kind: "provider-only synthetic smoke",
  commit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  working_tree_dirty: !!execFileSync("git", ["status", "--porcelain"], {
    encoding: "utf8",
  }).trim(),
  sdk: "@typesafe-ai/sdk@0.6.0",
  instance_id: null,
  actor_id: null,
  operation_id: null,
  model,
  available_models: available,
  prompt_version: PROMPT_VERSION,
  candidate_version: CANDIDATE_VERSION,
  p50_ms: percentile(0.5),
  p95_ms: percentile(0.95),
  pass: results.filter((r) => r.status === "PASS").length,
  total: results.length,
  results,
};
const path = process.env.JEV_SMOKE_OUTPUT ?? "../.tmp/jev-smoke.json";
await mkdir(new URL(".", `file://${process.cwd()}/${path}`).pathname, {
  recursive: true,
});
await writeFile(path, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    report: path,
    pass: report.pass,
    total: report.total,
    p50_ms: report.p50_ms,
    p95_ms: report.p95_ms,
  }),
);
