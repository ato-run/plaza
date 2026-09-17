# Plaza COOP Controller v0

This Node process attaches one child Actor to an existing Instance's App Room.
It uses the existing Activity Controller credential, grant and composition
connections. It does not create an Instance, copy room state, drive a PWA tab,
or use an account cookie to apply AI actions. The owner cookie is used only
by the optional one-time provisioning script to delegate a child Session.

## Preparation

Use a dedicated private/limited validation Instance. All observed participants
must consent in Plaza; TypeSafe disclosure requires its separate checkbox.
Do not use production conversation history as a test corpus.

1. Deploy the corresponding ato-api and Plaza revisions using the repository
   staging procedure. Coordinate the shared environment before deployment.
2. Keep `APP_ROOM_ENABLED` on. Enable `APP_ROOM_CONTROLLER_ENABLED` only with
   `APP_ROOM_CONTROLLER_INSTANCE_IDS` set to the explicitly approved Instance
   ID. The extension fails closed without the allowlist. No remote migration
   is introduced. Do not broadly enable `INSTANCE_COOP_ENABLED` for this test.
3. The owner's existing account × Instance AI access must be `write` or `full`.
   The child grant is further limited to `observe` and `interact`. It has no
   checkpoint/reset/export, other Actor motion, or arbitrary post capability.
4. On Node 20.6+ (tested locally with Node 25.6), run `npm ci` in `controller/`.
   Set `JEV_API_KEY` through the runtime secret/environment. An existing
   `.dev.vars` may be supplied with Node's `--env-file` option. Never bundle it
   into Vite, log it, or put it in app state, a Capsule or version control.

Provision through the existing APIs or run `src/provision.ts` once. The script
requires `ATO_API_ORIGIN`, `ATO_INSTANCE_ID`, `ATO_OWNER_SESSION_COOKIE` and,
if the trusted PWA origin differs, `ATO_OWNER_ORIGIN`. Use `ATO_ACTOR_ID` to
issue a new Session for a previously provisioned child. It creates a mode-0600
`.tmp/controller-session.env` outside the browser bundle and refuses to
overwrite an existing credential file. It performs no rollout or flag change.
Owner authentication is **not** passed to the execution transport.

```sh
# Run in controller/. Secret file paths below are operator supplied.
node --env-file=/absolute/path/operator.env --import tsx src/provision.ts
node --env-file=/absolute/path/.dev.vars \
  --env-file=../.tmp/controller-session.env --import tsx src/main.ts
```

Supervise that command with the existing deployment's process supervisor.
The daemon first registers as ready. The owner clicks **AIを参加させる** in
Plaza after consenting, then sends **AIへ指示**. Authorized owner controls
replace the goal in server order. Other participants can consent and observe,
but cannot control or stop another owner's AI. **一時停止／終了** directly
fences the room; neither waits for Jev. Resume requires a new instruction.

## Runtime contract

- API SDK pinned to `@typesafe-ai/sdk@0.6.0`. Choice is the only inference
  primitive used. There is no generated prose, SQL, coordinate or tool name.
  Candidates always include `no_action` and a templated clarification.
- `JEV_MODEL` defaults to `jev-latest`; verify it against the live models API
  before execution and record the resolved response model. The verified
  aliases on 2026-09-17 were `jev-latest` and `jev-preview`, with the tested
  response model `jev-1.13.0`. A response model ID is not assumed callable.
- At most one inference in flight and one reservation/second; no idle calls,
  SDK retries or provider/model fallback. Timeout is 5 seconds. One started
  session lasts at most 10 minutes with 30 calls. Node also enforces a lifetime
  30-call / USD 0.05 reserved upper budget; restarting cannot revive an old goal.
- Each request reserves 32,768 input tokens at the verified launch price of
  USD 0.042/million input tokens, with free output. Actual SDK usage is
  recorded separately. The reservation is conservative; recheck pricing
  before rollout. No undocumented service rate is assumed.
- A five-second execution lease excludes duplicate processes. Heartbeat is
  once/second. Pose is sent at most 10 Hz moving, 1 Hz idle, within the normal
  15 messages/second budget. Position and reaction remain ephemeral.
- The room, Session and execution epochs plus goal revision fence all effects.
  Live target pose must be no older than 1.5 seconds, in the same World and
  consented. Moving peers do not invalidate the whole model result. The
  executor continuously replans the local collision path without Jev calls.
- Stop and goal replacement discard the old result. Provider faults become
  degraded/waiting. A dead daemon leaves via heartbeat TTL. Closing the
  initiating PWA does not stop this independent Node process.
- Only a small projection of the explicit instruction and candidate meanings
  reaches TypeSafe. Ambient chat/other AI posts cannot become goals. SDK
  logging is forced off because its debug bodies may expose request content.
- Stable action/operation IDs bind an intent to its fence. Ambiguous durable
  responses are queried, then retried with identical ID and payload. The room
  rejects ID reuse by a different actor/epoch/payload. Receipts distinguish
  commit from transient application; the two-browser test verifies the final
  Plaza projection. Checkpoints authenticate AI authorship using compact
  commit digests, not presentation data.
- Central Plaza's shared collision math is used. Every possible exhibition
  slot is conservatively reserved by the AI, even when its card is unloaded.
  Other Worlds and arbitrary waypoints are intentionally unavailable.

## Verification and rollback

`npm test` at the Plaza root includes adapter/provider boundary tests. The
provider mocks are not Jev acceptance. `npm run typecheck` in this directory
checks the Node source. For synthetic real-API smoke:

```sh
node --env-file=/absolute/path/.dev.vars --import tsx src/smoke.ts
```

Smoke has an explicit separate 40-case / USD 0.10 reservation budget and writes
only synthetic inputs plus structured results to `.tmp`. The API repository's
`tests/plaza-coop/run.mjs` drives two isolated browser contexts, real local
D1/App Room, this Node daemon and real Jev. It uses fixture human identity and
does not prove staging account authentication or deployment. Its worker is
never included in `wrangler.toml`. See the acceptance record for exact SHA,
flags, cases, screenshots, measurements and remaining gates.

Rollback: pause/end the AI and verify the fence ACK; stop the supervised Node
process; remove the validation Instance from the controller allowlist (or turn
only `APP_ROOM_CONTROLLER_ENABLED` off). Keep the ordinary App Room flag and
checkpoint data. Previously committed posts remain. The extension requires
no D1 rollback. Revoke the child Session/binding via the existing lifecycle
when the validation ends. Delete only this run's ignored credential file.

Official references: [Skill](https://github.com/typesafe-ai/skills/blob/main/skills/typesafe-ai/SKILL.md),
[documentation index](https://docs.typesafe.ai/llms.txt),
[SDK](https://github.com/typesafe-ai/typesafe-sdk-js),
[launch pricing](https://typesafe.ai/blog/introducing-system-one-models-and-jev).
