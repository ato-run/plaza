# Browser startup SDK

`ato-startup-v1.js` is the unmodified common Ato browser startup SDK from
`ato-api/src/services/compute_instances/startup_asset.ts`, commit
`30f3934ea5d68103ed66038fbf122f90ad06573e`.

SHA-256: `d4ff8dc34a839cf3a4143f4d221e6005db04ac4d4fac021ff77b59f66c4a2d1e`.
It is bundled locally so standalone Plaza needs neither an app-proxy SDK route
nor an extra blocking request. Update from the common source; do not fork the
scheduler here. The common SDK owns visibility, yielding and cancellation.
