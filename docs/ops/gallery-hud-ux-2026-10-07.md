# Plaza HUD and gallery UX

Implementation base: origin/main e0e5479. No deployment, migration or feature
flag changes are part of this work.

The 3D scene and conversation footer occupy separate grid rows. The joystick,
jump and smaller crouch controls belong to the scene row, while connection
status, reactions and authentication actions wrap inside the footer. The footer
has a bounded scroll area for short viewports or enlarged text. Canvas resizing
uses the existing engine ResizeObserver.

A dismissible first-visit exploration guide uses optional local storage. Login
links use the existing ato sign-in destination in a new tab. The server's viewer
projection remains authoritative: a guest sees Login, an authenticated viewer
without posting permission sees the room restriction, and a missing projection
shows connecting status. Reload Plaza explicitly reloads the application so
identity is checked by a new connection handshake, rather than reusing stale
hello data. This does not change authentication or posting permissions.

Validation: typecheck and production build; all 171 Vitest tests passed after
installing controller dependencies with npm ci. Chromium renders the actual
Plaza WebGL scene with fixture App Room REST/WebSocket responses; narrow,
landscape and desktop geometry checks cover HUD containment, enlarged footer
text and authentication reload. These fixture checks are not staging account
or live multiplayer acceptance.

## Staging publication

User authorized deployment on 2026-10-07. Source `9a9f38fe79f06af27f9170bb02cdc97d6f8432ad`
is pushed as `origin/fix/plaza-responsive-hud`. The existing staging-only
`--ref` operator-publish path was reused with `VITE_PWA_ORIGIN=https://stg-app.ato.run`.
A task-local copy places scratch files under workspace `.tmp/` and reuses
previously verified immutable blobs, instead of re-uploading their identical
bytes. Newly uploaded blobs and the new manifest were read back and SHA-256
verified. No builder receipt was synthesized.

- Capsule revision: `caprev_plaza_0020`.
- Materialization: `swm_plaza_2vsI1m-RtrhGrQ7s`, 56 files, 17,442,835 bytes.
- Manifest: `sha256:f07b511a3d3601fa4d460d0d5415ce193c38a265be61a6fa72340c2c0650a47d`.
- Discover schema: `csch_discover_76be75d0cc631b2a23e36cfa`; existing `cap_plaza`
  and `discover-plaza` were updated through the existing seed script.
- Remote readback confirms catalogue schema, capsule revision and materialization
  agree. The catalogue's actual icon URL is unchanged.
- Login destination is pinned to staging PWA in the deployed build. Production,
  API Worker, feature flags, secrets and migrations were not changed.

Publication logs, manifest, R2 readback files and database receipts are in
workspace `.tmp/gallery-ux/`; live browser receipts belong to the companion PWA
worktree's `.tmp/`. A preliminary build without the PWA-origin pin was stopped
before catalogue/revision activation; its uploaded immutable blobs are harmless
and were reused where their bytes matched.
