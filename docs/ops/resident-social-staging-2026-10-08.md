# Resident Talk and reactions — staging, 2026-10-08

Talk and Enter resolve the same NPC as the interaction prompt; E remains available. All ten residents and Nagi acknowledge the existing four reactions. Resident acknowledgements are local to the viewer, briefly pause the resident, and do not create public room posts or model calls. Human chat and reactions retain their existing room transport and permissions. Guests may interact with NPCs.

Changing NPCs resets the dialog and ends the previous NPC conversation using its original NPC ID, preventing stale replies and history from following a new character.

## Evidence

- TypeScript and production build passed. Vitest: 190 tests across 20 files passed, including all residents/four reactions and Talk target routing.
- Actual browser, local app: bottom Talk opened Sora; Enter opened Calico. Sending text worked through the local fallback. Sora acknowledged heart with “Yes! That's the spirit!”; Calico acknowledged thumbs-up with “Aww, thanks... that woke me up!” on a 390px viewport. Closing the dialog returned to exploration.
- No new inference/API implementation, migration or feature flag changes. Local checks do not claim new real-model acceptance.
- Staging source: `0337cee930d7c8edebc905b766e6f0719c42d945`, branch `staging/plaza-resident-social-20261008`. Preserves existing compact controls from PR #15.
- Publication: `caprev_plaza_0026`, `swm_plaza_luiFR7qf022v14Rz`.
- Manifest: `sha256:b45d4e5d30cf942097e729ab028dc3dcfa19694f160ba3e645286bf62ce241ed`.
- All 56 objects (17,637,124 bytes) and manifest read back from staging R2 and digest-verified before canonical revision publication. Temporary operator copy uses workspace `.tmp` paths and groups independent R2 operations in fours; canonical publication remains sequential.
- Main change is PR #16; production not deployed by this task.

Staging Discover was updated to schema `csch_discover_5412eecfad8b67c8d71b84d8`. The real staging iframe rendered the scene and loaded `/__ato/assets/sha256:b45d4e5d30cf942097e729ab028dc3dcfa19694f160ba3e645286bf62ce241ed/assets/index-BYeaPt1t.js`. Interactive staging verification was limited by the browser tool rejecting frame clicks; the interaction acceptance above is local real-browser evidence, not a staging/model claim.
