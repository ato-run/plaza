# Plaza open-air implementation and acceptance

Scope: all 60 review items, preserving avatars and the WebGL renderer. No claim of AAA asset fidelity or completed live acceptance is made from unit tests. Changes use the existing App Room, catalogue, conversation, renderer and avatar boundaries.

`A` below means automated behavioral coverage; `V` means browser visual/play check required. Entries describe implemented behavior. Staging results and screenshots are recorded separately after publication.

| #   | Implemented behavior                                                                                  | Source / acceptance                                  |
| --- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1   | Clear entrance-to-fountain route, bench moved out of that route                                       | centralGeometry; A spawn route                       |
| 2   | Rotated rectangles match bench dimensions; low tops support climbing                                  | centralGeometry, collision; A                        |
| 3   | Planter footprint matches rim, with supported top                                                     | centralGeometry; A collision                         |
| 4   | Visible perimeter dune, safe wading buoys at water-depth limit                                        | coast, openAir/scene; A/V                            |
| 5   | Oblique collisions slide along the available axis                                                     | collision; A                                         |
| 6   | Grounded movement clears small 24 cm steps                                                            | engine; A model; V stairs                            |
| 7   | Jump toward a low ledge pulls onto an unobstructed actual surface                                     | openAir/mantle, engine; A 4 cases/V                  |
| 8   | Rock shortcut and low furniture provide jump routes                                                   | layout, scene; A/V                                   |
| 9   | Crouch avoids startling crabs and enables observation                                                 | scene; V                                             |
| 10  | Sensitivity, inverted vertical look, optional walking bob and sound volume                            | settings, PlazaMenu; V                               |
| 11  | Pool arch, pier sail and camp canopy visible as different destinations                                | scene; V                                             |
| 12  | Dune route and shells provide discoveries beyond the central furniture                                | layout, scene; V                                     |
| 13  | Lookout platform raises the view above the coast                                                      | layout, scene; V                                     |
| 14  | A carved tidal basin and rock arch distinguish the cove                                               | coast, scene; A/V                                    |
| 15  | Beach approach and tidal rocks provide alternative pier routes                                        | layout, coast; A/V                                   |
| 16  | Shells, driftwood, stones, crabs and camp placed along short walking routes                           | layout, model; V pacing                              |
| 17  | Stone arch, raised steps, sail and canopy have distinct silhouettes                                   | scene; V                                             |
| 18  | Fountain and route signposts give return landmarks                                                    | scene, central-plaza; V                              |
| 19  | Local footprints and shell breadcrumbs mark recent paths                                              | scene; V                                             |
| 20  | Fountain observation registers a discovery and reveals coastal landmarks                              | scene, model; A/V                                    |
| 21  | All five prop types share pick/place/throw and ordered ownership                                      | model, scene, PlaygroundPage; A                      |
| 22  | Thrown items splash and emit expanding water rings on landing                                         | scene, audio; V                                      |
| 23  | Wood, balls and leaves float; stones and shells settle                                                | model; A                                             |
| 24  | Vegetation, sail, windmill and loose leaves follow the shared clock/weather                           | clock, scene, central-plaza; A/V                     |
| 25  | Footprints fade and disappear when washed by tide                                                     | scene; V                                             |
| 26  | Wading creates foot ripples and water-entry/edge feedback                                             | scene, engine, audio; V                              |
| 27  | Sand, wet ground, stone and pier wood have distinct footstep sounds                                   | audio, engine; V audio                               |
| 28  | Birds, fountain and camp sounds attenuate and pan with position                                       | audio; V audio                                       |
| 29  | Shell arrangement, floating wood, moving leaves and bouncing balls are playable                       | model, scene; A/V                                    |
| 30  | Walk/jump routes and place/throw arrangements allow multiple approaches                               | layout, model; A/V                                   |
| 31  | Lighting override stays local; tide/weather/routines use shared time                                  | engine, clock; A/V                                   |
| 32  | Bootstrap supplies server time; operations keep original commit time                                  | API room_storage/AppRoom; A                          |
| 33  | Tide changes the exposed route; stranded visitors can move toward shallower water                     | coast, central-plaza; A/V                            |
| 34  | Tidal crabs hide from standing visitors and appear for crouching observers                            | coast, scene; V                                      |
| 35  | Shallow color, shoal geometry and safety buoys indicate depth                                         | coastShader, scene; V                                |
| 36  | Deep water limits movement and gives water feedback                                                   | engine, coast; A/V                                   |
| 37  | All ten residents gather at camp in shared evening/night routines                                     | life; A/V                                            |
| 38  | World-space stars and an optional camp observation exist at shared night                              | scene, model; A/V                                    |
| 39  | Deterministic rain/wind, shelter cover and matching resident gathering                                | clock, life, scene; A/V                              |
| 40  | Four exclusive camp seats, sunset observation and resident reactions                                  | model, scene, engine; A/V                            |
| 41  | Nagi describes actual verified displays; empty exhibition is explicit                                 | knowledge, API NPC service; A/V                      |
| 42  | Ten resident jobs have distinct destinations, props and animation                                     | life, villager; A/V                                  |
| 43  | Pools: shells/crabs; pier: floating wood; camp: seats/shelter/sky; lookout: climb/view                | scene, layout; V                                     |
| 44  | Nearby residents acknowledge actual pickup/placement/throw events                                     | villager; V                                          |
| 45  | Reactions are committed events with resident body/head responses                                      | model, villager, world; A/V                          |
| 46  | Selected character gets a ring; conversations use Enter/Talk, never Talk E                            | world, interaction, PlaygroundPage; A/V              |
| 47  | Voluntary escort follows traversable routes at walking speed and waits for owner                      | villager, PlaygroundPage; V                          |
| 48  | Optional joint shell, pier, sky and lookout outings; no forced quest                                  | GuideDialog, scene; V                                |
| 49  | Last four actual encounters expire after 15 minutes; same-visitor facts enter model context           | model, adapter, NPC service; A                       |
| 50  | Exclusive shared NPC reservations and seats; live resident colliders/separation                       | model, villager; A/V                                 |
| 51  | Speech bubbles clamp to both horizontal and vertical viewport edges                                   | world, CSS; V desktop/mobile                         |
| 52  | Brief first greeting; further guidance remains voluntary                                              | nagi, GuideDialog; A/V                               |
| 53  | Menu/dialog pauses input, restores engaged view and clears stale movement/jump                        | engine, PlaygroundPage; V                            |
| 54  | Compact touch controls and expandable reactions; bounded dialog/journal                               | CSS, PlazaMenu; V mobile                             |
| 55  | Unimplemented worlds hidden from menu                                                                 | PlazaMenu; V                                         |
| 56  | Camp/lookout/pools/pier are continuous places in the central world                                    | layout, central-plaza; A/V                           |
| 57  | Empty display sign opens Talk for sharing a public app link                                           | scene, world; V                                      |
| 58  | Public links resolve to real catalogue cards; Try opens app, original plaza remains                   | sharedLink, API lobby/cards, GuideDialog; A/V        |
| 59  | Talk-about-app drafts a public link; shared Activity displays use existing Join route                 | PlaygroundPage, world; V multi-client                |
| 60  | Three-client ordering, first-winner ownership, timestamp replay, pose guards and forged-state refusal | API app-room test; local and staging A complete; three scripted clients |

## Verification and staging rollout — 2026-10-09

- Plaza source: `826f970d41a1d191d0bcc90a946410b2ca92b5c1`, PR https://github.com/ato-run/plaza/pull/17.
- API deployed source: `5992572c`, PR https://github.com/ato-run/ato-api/pull/761. Worker `34a2c0c6-9bee-4355-90a6-011e3eb6c9c8`; health 200, 43 existing secrets preserved.
- Plaza publication: `caprev_plaza_0030`, materialization `swm_plaza_NuKrfBHCxFQqKAoo`; all 56 R2 objects verified against real bytes. Discover catalogue updated.
- Plaza: 222 tests in 25 files passed; final TypeScript and production build passed after main integration and final scene fixes.
- API: TypeScript passed on the final generated adapter; 79 related tests plus 73 boundary tests passed; final regenerated adapter App Room/NPC checks: 55 passed. Counts overlap and must not be summed.
- Live staging acceptance run `64a915fd30bc`: three independently authenticated scripted HTTP/WebSocket clients agreed on durable event order, original timestamps and one pickup winner. History replay, retry after moving, cross-actor ID rejection, forged checkpoint replacement, exclusive seats and actual resident reaction memory all passed. Test sessions revoked.
- Actual Workers AI NPC call returned HTTP 200, mode `llm`, and did not invent available exhibition apps.
- Browser: deployed Discover entry loaded; direct deployed instance supported keyboard walking to the lookout vicinity and menu pause/settings. Pool arch and pier were visible. Local production preview also verified fountain support and walking steps; a 390×844 layout was checked.
- Proof images in this checkout: `.tmp/open-air-staging.png`, `.tmp/open-air-mobile.png`. API live evidence is committed in its `docs/ops/plaza-open-air-live.json`.
- Remaining acceptance limits: no three-human session, physical phone multi-touch, sustained device FPS/memory profiling or listening evaluation of generated spatial audio. Visual behavior marked V above is implementation coverage, not a claim that every scenario was manually exercised.
- No migration, binding or feature flag changed; production remains untouched. PRs remain draft while the remaining device/usability acceptance is reviewed.

## Rollout contract

API before Plaza. No migration/binding/flag change. Preserve shared-world posts in checkpoints even while a single world is viewed. Server-derived simulation projection replaces forged client exploration data; live reducers only accept original server timestamps. Publication must use the pushed clean source commit and verified R2 bytes. Production is separate from staging.
