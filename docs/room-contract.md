# Plaza room acceptance criteria (Phase B)

Fixed before migration. These numbers are the App Room budgets
(`apps/ato-api/src/services/app_room/protocol.ts`); Plaza accepts them
as-is and shapes its protocol to fit. World split reduces *fanout*, never
*slots*.

## Budgets

| Resource | Bound | Plaza consequence |
|---|---|---|
| Room capacity | 16 principals, 32 sockets (shared across Worlds) | A World is a delivery scope, not a room. Full room → `app_room_full` (503); client shows "room full", never silently drops |
| Transient budget | 15 msg/s per socket, shared by presence + ephemeral | Transforms throttle to 10Hz; typing/reaction sporadic. Over-budget messages are dropped, never queued |
| Ephemeral payload | ≤ 1024 bytes, TTL ≤ 60s (default 5s) | `plaza.transform` ≈ 100 bytes. Face reactions TTL 2.4s |
| Durable op | ≤ 16 KiB, 5000 retained | One post ≈ 0.5 KiB. Suffix holds days of chat; seal every ≤200 ops of drift |
| Catch-up page | 200 events | Client pages `after` until `high_water_cursor` |
| Checkpoint | ≤ 256 KiB | Seal = latest ≤200 posts + settings (≈ 100 KiB worst case) |
| Socket lifetime | 30 min → 4001 re-auth close | Reconnect + re-bootstrap; never extend silently |

## Invariants (tested)

1. **Scope narrows delivery, never membership.** Roster/join/leave are
   global; only `ephemeral` broadcasts filter by scope. A client that has
   never sent a scoped message receives unscoped traffic only.
2. **Posting ≠ sealing.** Viewers post iff `open_posting`; checkpoint /
   export / reset never follow. Editors seal by owner trust ("use together").
3. **Authorship is unforgeable.** `actor_id` on every op envelope is
   edge-injected. Delete-others ops are ignored by conforming clients and
   never enter a sealed state (sealer derives seals from valid ops only).
4. **Seal arbitration is the trust anchor.** Bootstrap = sealed state +
   suffix. A malicious seal requires seal rights; seal rights require owner
   trust.
5. **Reset is epoch-fenced.** Pre-reset cursors stay comparable
   (AUTOINCREMENT monotonic); stale-epoch writes get 409, never silent apply.
6. **Log-full fails to seal-request, not to loss.** 503 `log_full` +
   `checkpoint_requested` broadcast. Owner-absent rooms wedge on write
   until a sealer seals — accepted, with the official instance running an
   operator sealer (Phase D runbook).

## History policy

- Sealed state: latest 200 posts (full bodies + reaction counts) + room
  settings. Older posts survive only in the op suffix until GC.
- New rooms start empty. Official migration (Phase D) imports history once,
  idempotently; presence/credentials are never migrated.


## Optional COOP Controller extension

`plaza.coop@1` attaches a separate child Actor to the existing per-instance
App Room. It is enabled only on the API's explicit validation Instance
allowlist. A Browser Runner bridge selects the existing Runner lane; the AI
controls are not mounted there and a transform is never sent to both lanes.

The same pure `src/playground/coop/adapter.ts` supplies semantic validation to
Plaza and the generated API adapter. Rebuild the latter with
`node scripts/build-coop-adapter.mjs /absolute/path/to/ato-api/src/app_adapters`;
`plaza.provenance.json` hashes every input and the bundle. Do not hand-edit it.

Server-derived `actor_kind: agent` and verified actor metadata identify AI
posts and roster entries. Presentation data cannot create that label. Existing
account/guest events and v1 checkpoints remain readable. Compact server commit
digests authenticate AI authorship during checkpoint/restore. Poses are never
sealed. Epoch/actor/schema/payload-bound IDs preserve retry identity for the
24-hour dedupe period; legacy compacted rows without actor evidence fail closed.

`AppRoomTransport.prepareMutation()` freezes the ID, epoch and serialized op.
Retry the same prepared invocation through `invoke()`; an explicit new human
operation prepares a new ID. The Node Controller also queries a self-scoped
receipt after ambiguous commit delivery before repeating the same invocation.
A seq is ordered commit evidence. The two-browser acceptance checks the final
post projection separately; ephemeral receipts never claim persistence.

See [Controller operation and rollback](../controller/README.md). Start,
consent, goal, pause/resume and end use same-origin `/__ato/app-room/coop/*`
with the existing Instance access identity. The owner controls the AI; other
participants control only their own observation/disclosure consent. Model keys
and Controller Session credentials are absent from the browser artifact.
