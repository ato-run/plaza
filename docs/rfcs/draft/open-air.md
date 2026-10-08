# Plaza open-air v1

Status: draft implementation contract, 2026-10-08.

One continuous central-plaza room owns a coast, dune overlook, tide pools, pier,
rain shelter and beach camp. Other unbuilt rooms stay unavailable and hidden.
The existing App Room ordered operations and checkpoints carry object ownership,
launches, observations, recent resident encounters and renewable conversation/
escort leases. No new Kernel primitive, credentials, migration or model flag.

The server's committed_at evidence orders time-dependent operations. Shared world
clock is synchronized from bootstrap server_time_ms; local lighting overrides
never affect tide, routes, weather or residents. Leases expire after 30 seconds,
renew every 10 seconds, and release explicitly on close. Disconnects expire;
first committed claimant wins. Objects expire out of inventories after 90 seconds.
Old seals without open_air restore initial state; unknown ops remain cursor-only
no-ops for old clients. New clients preserve all-world social posts on checkpoint.

Object operations have allowlisted IDs, bounded positions/velocities, a fixed
reach and per-actor holding limit. The pure reducer validates ownership and
applies committed events exactly once, in order, including replay after a seal.
Three.js only materializes that state. Movement, ground support and resident
navigation share geometry. Audio starts only after a user's gesture and is
optional. All authored resources and listeners are released on world disposal.

Acceptance: all 60 review numbers map to code and tests/manual observations in
`docs/ops/open-air-acceptance.md`. Automated multi-client simulation is not live
three-person acceptance. Staging verification precedes any production release.
