/** Bounded local measurements; no account, message or location data are recorded. */
const samples = new Map<string, number[]>();
export function measureInteraction(kind: string, started: number): void {
  const values = samples.get(kind) ?? [];
  values.push(Math.max(0, performance.now() - started));
  samples.set(kind, values.slice(-100));
}
export function interactionMeasurements(): Record<
  string,
  { count: number; medianMs: number; p95Ms: number }
> {
  return Object.fromEntries(
    [...samples].map(([kind, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return [
        kind,
        {
          count: sorted.length,
          medianMs: sorted[Math.floor(sorted.length / 2)],
          p95Ms:
            sorted[
              Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))
            ],
        },
      ];
    }),
  );
}
const pendingInputs = new Map<string, number>();
export function beginVisualInput(kind: string): void {
  const at = performance.now();
  if (!pendingInputs.has(kind)) pendingInputs.set(kind, at);
  if ((kind === "look" || kind === "movement") && !pendingInputs.has("target"))
    pendingInputs.set("target", at);
}
export function measureVisualFrame(): void {
  for (const [kind, at] of pendingInputs)
    measureInteraction(`${kind}:visual`, at);
  pendingInputs.clear();
}
