# Plaza — one shared lobby

Plaza is Ato's shared lobby as a standalone app: walk a first-person 3D
world, talk to the people near you, and try what you find. Licensed under
the Apache License 2.0 (see `LICENSE`).

## Status

Normal Instances use their own App Room at `/__ato/app-room` for REST and
WebSocket. Posts use the ordered `plaza.room@1` durable lane; movement and face
reactions are ephemeral. An existing Browser Runner bridge selects the separate
`ato.playground.world@1` adapter. The old Phase A/global lobby description no
longer describes this code.

An optional [COOP AI Controller](controller/README.md) joins that same Instance
as its own verified Actor. It runs in Node, requires an explicit Instance
allowlist and participant consent, and uses TypeSafe Choice over app-defined
candidates. The feature is off by default; this source tree alone does not mean
an artifact, Runner or flag is deployed.

## Develop

```sh
npm ci
npm run dev      # http://localhost:5174
npm test         # vitest
npm run build    # dist/
```

Card links (`/a/<slug>`, activities, sign-in) resolve against
`VITE_PWA_ORIGIN`. Unset in dev, where the serving origin is used.

## Third-party code

- `three` (MIT) — 3D rendering
- `react` / `react-dom` (MIT) — UI

The Runner protocol surface in `src/shared/runnerProtocol.ts` mirrors
`apps/ato-pwa`'s `src/shared/BrowserRunnerBridge.ts` (pinned version in
the file header). The PWA definition is canonical until a shared package
exists; keep the two in step by hand.
