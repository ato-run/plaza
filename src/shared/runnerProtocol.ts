/**
 * Runner protocol surface, mirrored for Plaza.
 *
 * Canonical definition: `apps/ato-pwa`'s `src/shared/BrowserRunnerBridge.ts`
 * (and `AtoBrowserBridge.ts` for the window handles).
 * Pinned against `BROWSER_RUNNER_BRIDGE_VERSION = "0.3.0"`.
 *
 * This file is intentionally MINIMAL: it declares only the structural surface
 * Plaza's adapter and page actually touch, so the 1500-line bridge
 * implementation and its delivery-path behaviour (ordering, dedupe, ACK,
 * receipts) stay owned by the PWA. Do not grow this file towards a second
 * bridge — if the surface needs more, extract a shared package instead and
 * delete this mirror.
 *
 * Compatibility is structural: Plaza never imports the PWA types, so a
 * drift here fails loudly at the call site rather than silently.
 */

export interface RunnerProtocolPayload {
  type: string;
}

export interface BrowserRunnerStateProjection {
  revision: string | number;
  summary: unknown;
}

export interface RunnerOperationDescriptor {
  kind: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/**
 * The subset of capability claims the Playground adapter reads.
 * The canonical claims carry far more (session, epochs, observe/interact);
 * enforcement of those lives on the bridge side, not in this adapter.
 */
export interface BrowserRunnerCapabilityClaims {
  actor_id: string;
}

export interface RunnerProtocolAdapter {
  readonly protocol_id: string;
  readonly operations?: readonly RunnerOperationDescriptor[];
  validate(kind: string, payload: unknown): void;
  apply(
    payload: RunnerProtocolPayload,
    authority: BrowserRunnerCapabilityClaims,
  ): void | Promise<void>;
  projectState?: () => BrowserRunnerStateProjection;
  projectSnapshotFor?: (
    observer: BrowserRunnerCapabilityClaims,
  ) => BrowserRunnerStateProjection | undefined;
  projectAppliedState?: (
    payload: RunnerProtocolPayload,
    authority: BrowserRunnerCapabilityClaims,
  ) => BrowserRunnerStateProjection | undefined;
  observesProjection?: (
    projection: BrowserRunnerStateProjection,
    observer: BrowserRunnerCapabilityClaims,
  ) => boolean;
  actorAttached?: (authority: BrowserRunnerCapabilityClaims) => void;
  actorDetached?: (
    authority: BrowserRunnerCapabilityClaims,
  ) => BrowserRunnerStateProjection | undefined;
}

/** Fired on `window` when a Runner bridge becomes available. */
export const ATO_BROWSER_BRIDGE_READY_EVENT = "ato:browser-bridge-ready";

export interface RunnerControllerPresentation {
  display_name: string;
  principal_id?: string;
}

export type RunnerControllerState =
  | { ready: false }
  | {
      ready: true;
      actor_id?: string;
      actor_presentation?: RunnerControllerPresentation;
    };

export interface RunnerObservation {
  protocol_id?: string;
  state?: unknown;
}

/** Structural subset of the PWA's `AtoApplicationControllerHandle`. */
export interface ApplicationControllerHandle {
  subscribeState(listener: (state: RunnerControllerState) => void): () => void;
  subscribeObservation(
    listener: (observation: RunnerObservation) => void,
  ): () => void;
  dispatchOperation(
    protocolId: string,
    kind: string,
    payload: RunnerProtocolPayload,
  ): boolean;
  requestSnapshot(protocolId: string): void;
}

/** Structural subset of the PWA's `AtoBrowserBridgeHandle`. */
export interface BrowserBridgeHandle {
  registerProtocolAdapter(adapter: RunnerProtocolAdapter): () => void;
  subscribeControllerState(
    listener: (state: RunnerControllerState) => void,
  ): () => void;
  dispatchOperation(
    protocolId: string,
    kind: string,
    payload: RunnerProtocolPayload,
  ): boolean;
}

declare global {
  interface Window {
    atoApplicationController?: ApplicationControllerHandle;
    atoBrowserBridge?: BrowserBridgeHandle;
  }
}
