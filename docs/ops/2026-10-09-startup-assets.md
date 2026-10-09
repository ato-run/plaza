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

Source `472454be1b9ee250ef67de31ef4393f666ed837a` on
`perf/initial-load-optimization` was published through the existing staging
operator lane. It rebuilt the clean pushed source, uploaded all 58 files,
read every object back and checked its SHA-256 before marking the materialization
ready. The existing Discover publication retained its thumbnail and now pins:

- Revision: `caprev_plaza_0031`.
- Materialization: `swm_plaza_BcbVbm246gcSuQGV`.
- Manifest: `sha256:ddd4fa2ecc9417e2fddb6104b6a16e63b084ffd2ce9426bd568cd0ccaa9f23f8`.
- Schema: `csch_discover_4be71bd945827eb0b63e5cb1`.

Chrome reloaded `https://stg-app.ato.run/` and opened the new shared static
Instance at `https://cinst-viqveiwlqslxi4wo.stg-app.ato.run/`. Its actual script
tag references `index-CPyi3hKm.js` in the new manifest namespace. The World,
scanned scenery and connected room rendered; Menu and Sunset selection worked.
The local lighting override was then restored to Shared clock and Menu closed.
Screenshot: `.tmp/startup-staging-chrome.png`. Unauthenticated direct reads
of the Instance document and namespaced asset correctly returned 401; browser
authorization was retained and not bypassed for byte inspection.

API health and paged Discover return 200, and both unauthenticated curation
routes return 401 rather than 404. Candidate counts remain 413 total (117 ready,
225 queued, 50 needs_input, 18 unsupported, 3 failed), with zero active attempts.
No migration was pending or applied. API/PWA/Runner were not redeployed; the
active API Worker remains `afcf870a-a5b6-4fca-b4f7-3034e036a7a9` at 100%.
No production, flags, Runner capacity, Formation or existing saved data changed.

Publish, seed, deployment/migration checks and before/after D1 evidence are
under the staging API worktree's `.tmp/plaza-startup-*`. PR: ato-run/plaza#18
(Draft). No GitHub check runs were attached at verification time.

An additional native Chrome Performance recording of the preceding staging
revision (no throttling, existing cache) is saved locally as
`.tmp/startup-staging-before.json.gz`. Over its 5.43-second trace, sampled CPU
time mapped through the unchanged baseline source map attributes approximately
531 ms to Three.js program first use, 374 ms to texture upload, 174 ms to
`rippleTexture`, and 66 ms to `buildGrid`. Browser extensions also consume time.
This single recording is diagnostic, not an interaction percentile. It led to
the following additional change.

## Procedural ripple generation

The ripple normal/foam map uses integer frequencies, so each wave has only
`size` distinct phases. Precomputed phase and amplitude tables replace the
per-pixel sine/cosine calls (~6 million → ~24 thousand at 256 pixels). Tables
are temporary to one invocation; texture data remains separately owned and
disposed by each caller. No persistent cache, new file download, lower map
resolution, shader change or GPU resource sharing is introduced.

SHA-256 goldens captured before the change prove every byte is preserved at
17, 96 and 256 pixels. Texture sampling and independent buffer ownership also
pass. All 231 tests / 27 files, typecheck and build pass. The final initial
bundle is 927.45 kB (269.67 kB gzip); the optional GLTF chunk remains 43.89 kB.

A CPU-only prototype measured the 256-pixel direct calculation at 171–296 ms
versus 33–95 ms with indexed tables (`.tmp/profile-ripple-indexed.jsonl`). This
is a Node diagnostic, not a browser percentile.

The browser comparison was then repeated with the native Chrome tab explicitly
selected and visibility recorded throughout every sample. All 42 samples
(40 measured + 2 warm priming) stayed visible. Same local harness/action as
above, original baseline versus both changes, ten samples per cell:

| Build | Cache | p50 | p95 |
| --- | --- | ---: | ---: |
| Original baseline | Cold | 1075.5 | 1131.2 |
| Deferred assets + ripple tables | Cold | 749.4 | 805.0 |
| Original baseline | Warm | 1051.0 | 1113.0 |
| Deferred assets + ripple tables | Warm | 746.8 | 933.8 |

These are local scripted lighting actions, not real staging navigation-to-input
percentiles. An intervening batch ran behind an active staging 3D tab and was
stopped; it is preserved as `.tmp/ripple-benchmark-background.json` and excluded.
The earlier asset-only benchmark did not record visibility and is diagnostic
only. Use the explicitly visible batch for the final local comparison.
Evidence: `.tmp/ripple-benchmark.mjs`, `.tmp/ripple-benchmark-results.json`,
`.tmp/ripple-benchmark-summary.json`, `.tmp/ripple-tests.log`,
`.tmp/ripple-build.log`. Staging publication of the ripple change is pending.

The overall startup optimization remains incomplete: staging cold/warm,
signed-in/out and static/Hosted navigation-to-action measurements are still
required. The separate startup-experience proposal work has not started.
