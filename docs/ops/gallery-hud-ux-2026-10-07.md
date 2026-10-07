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
