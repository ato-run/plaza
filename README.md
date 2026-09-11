# Plaza — one shared lobby

Plaza is Ato's shared lobby as a standalone app: walk a first-person 3D
world, talk to the people near you, and try what you find. Licensed under
the Apache License 2.0 (see `LICENSE`).

## Status

Phase A of the independence plan: extracted from `apps/ato-pwa`'s
`src/playground` into this app with no PWA dependency. It still talks to
the lobby backend served by `apps/ato-api` on the canonical app host
(same-origin ` /__ato/playground/*`), so it is **not** yet backend
self-hostable — each Instance has its own room only after the App Room
migration (Phase B). The README will say so exactly when that lands.

## Develop

```sh
npm install
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
