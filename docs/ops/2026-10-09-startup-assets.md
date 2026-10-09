# Defer optional world assets

The first render previously competed with 51 beach image/model requests and a
statically imported GLTF loader. The procedural World, colliders, input,
residents and room protocol remain the required path. Seven optional asset
groups now start sequentially, after the engine renders that World and the
common browser startup SDK yields to the browser. GLTFLoader is a dynamic
import reached only when the model task runs.

Plaza bundles an exact pinned copy of the common SDK (provenance in
`src/vendor/README.md`). There is no new remote bootstrap request, platform
special case, selection planner, shared-data cache, allocation or feature flag.
Unmount cancels queued work. SDK page-exit cancellation also aborts existing
World loaders, whose late decode/disposal checks remain in force. A hidden
document does not start another optional group. One slow group can delay later
decorations but cannot hold up the procedural World or local controls.

The SDK's critical-ready event marks the first rendered local World after
input setup. It does not imply room connection, saved/shared-state readiness,
successful user interaction, Discover usage or runtime verification.

## Local evidence

- Baseline: `ba10d13` (same tree as the existing open-air staging source).
- 227 tests across 26 files passed, including first-frame ordering, sequential
  groups, old-World cancellation, page exit, hidden documents and SDK digest.
- Typecheck and production build passed. Initial JS: 965.96 → 927.19 kB;
  gzip: 279.87 → 269.54 kB. Optional GLTF chunk: 43.89 kB (12.91 kB gzip).
  Initial HTML does not preload that chunk.
- Native Chrome opened a local comparison harness using production builds,
  a 960×540 iframe and actual WebGL, without CPU/network throttling. Each sample
  waits for enabled exploration controls and two frames, opens Menu, switches
  to a different lighting setting, observes its selected state and waits a
  frame. Those scripted DOM actions are a local regression benchmark, not
  trusted input or staging end-to-end acceptance. Local app-room endpoints are
  absent; authenticated multiplayer behavior is not covered.
- Cold samples use distinct asset URL namespaces. Warm samples use one
  namespace after a discarded priming sample. Ten measured samples per cell;
  nearest-rank percentiles in milliseconds:

| Build | Cache | p50 | p95 |
| --- | --- | ---: | ---: |
| Baseline | Cold | 1085.8 | 1261.3 |
| Deferred assets | Cold | 828.0 | 1036.1 |
| Baseline | Warm | 1002.2 | 1028.0 |
| Deferred assets | Warm | 816.4 | 845.7 |

An earlier exploratory batch overlapped a build and had an incorrect warm
priming namespace; it is retained separately and excluded from this table.
The measured batch ran after validation finished, with corrected priming and
an actual setting change on every sample. Resource Timing counts completed
requests, not pending requests. Two remaining long tasks generally spend
roughly 340–370 ms in synchronous setup and 210–230 ms before the first render;
this change does not eliminate that CPU cost. Cold p95 still exceeds one second.

The harness also withheld every beach response. Automatic lighting selection
completed in 799 ms; native Chrome then selected Sunset and showed it selected
while the procedural World remained rendered. No GLTF download was needed for
that action. Evidence lives under `.tmp/`: `startup-benchmark.mjs`,
`startup-benchmark-results.json`, `startup-benchmark-summary.json`,
`startup-benchmark-initial-confounded.json`, `startup-held-chrome.png`,
`deferred-tests.log`, and `deferred-build.log`.

## Staging

Pending operator publication from this clean, pushed branch and actual Chrome
verification. Production, migrations, flags, Runner capacity and Formation
are outside this rollout. The existing curation ledger must remain unchanged.

The overall startup optimization remains incomplete: staging cold/warm,
signed-in/out and static/Hosted navigation-to-action measurements are still
required. The separate startup-experience proposal work has not started.
