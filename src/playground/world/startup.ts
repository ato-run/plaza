import "../../vendor/ato-startup-v1.js";

interface StartupContext {
  signal: AbortSignal;
  yield(): Promise<void>;
}

export type DeferredWorldTask = (context: StartupContext) => Promise<void>;

declare global {
  interface Window {
    atoStartup: {
      readonly version: 1;
      registerRetention(contract: { suspend(): void; resume(): void; memoryBytes(): number }): () => void;
      measure(stage: string, duration: number): void;
      mark(phase: "script-ready" | "first-render" | "interactive" | "connected" | "first-action" | "complete"): void;
      run(options: {
        signal: AbortSignal;
        critical(context: StartupContext): Promise<void>;
        deferred: readonly DeferredWorldTask[];
      }): {
        ready: Promise<void>;
        finished: Promise<void>;
        cancel(): void;
      };
    }
  }
}

/** Called after synchronous input/world setup; release only after rendering it. */
export function deferWorldAssets(
  worldAbort: AbortController,
  tasks: readonly DeferredWorldTask[],
): () => void {
  const signal = worldAbort.signal;
  let rendered!: () => void;
  const firstFrame = new Promise<void>((resolve) => { rendered = resolve; });
  let disconnect = () => {};
  const startup = window.atoStartup.run({
    signal,
    critical: ({ signal: startupSignal }) => {
      // Asset loaders already own the World's signal. Forward SDK cancellation
      // (including pagehide) to it so late decodes cannot attach after exit.
      const abort = () => worldAbort.abort(startupSignal.reason);
      startupSignal.addEventListener("abort", abort, { once: true });
      disconnect = () => startupSignal.removeEventListener("abort", abort);
      return firstFrame;
    },
    deferred: tasks,
  });
  void startup.finished.catch((error: unknown) => {
    if (!signal.aborted && !(error instanceof DOMException && error.name === "AbortError")) {
      console.warn("[plaza] optional world assets unavailable");
    }
  }).finally(() => disconnect());
  return () => {
    if (signal.aborted) return;
    window.atoStartup.mark("first-render");
    window.atoStartup.mark("interactive");
    rendered();
  };
}
