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

## Jump/Crouch icons follow-up

Both touch controls use 26px decorative SVG figures instead of visible text. Accessible names, pressed state and existing touch-down handling are retained. TypeScript/production builds passed. Staging preserves compact controls and publishes commit `4a090923861ab686cbba95c1e959d6d5ef7cbfd3` as `caprev_plaza_0027` / `swm_plaza_aHUvmTufyuGkyXEx`, manifest `sha256:c0fbe9a516f93ff03d02ded19501b7374c5321f87cd5d07404e69a1c049a4af2`. All 56 objects and the manifest passed R2 readback verification.

## Enter navigation follow-up

Conversation targets (people, residents and Nagi) no longer show the floating Talk E interaction prompt. Enter and the bottom Talk control open their existing conversation path. Seats/exhibits retain their interaction prompt. The control menu explicitly lists people, residents and Nagi under Enter. TypeScript/production builds passed.

Staging integration commit `729a0c0da2784b93b8ce8bfb1486636ec8f54e79` published as `caprev_plaza_0028` / `swm_plaza_GGWZzVcRouQpvB9c`, manifest `sha256:70d6dc5846ec0b3cfc6ea4032da0a2616be679aa3dbf2a9821f282ead9ae6ab6`. Existing verified immutable blobs were reused; all 56 objects and manifest were fetched from R2 and digest-verified again before publication.

## Retire E for conversations

The object interaction handler now rejects person/resident/guide targets, retiring E-based conversations as well as their prompt. Enter and the bottom Talk control retain their conversation routing; E remains for seats/exhibits. Three focused regression tests and TypeScript/production build passed. Real local browser: Enter opened Calico, E after closing did not open a conversation, and Enter opened Calico again.

Staging commit `85397b871ca3af62a1e9896f5d909ed122129aba` published as `caprev_plaza_0029` / `swm_plaza_JZQbz_f3ufVWoEjI`; manifest `sha256:a9b9bae9f2cea855c13277589959f000f8f30e6e456a3ee4161a680c052f98a4`. All 56 objects and manifest passed R2 readback verification.
