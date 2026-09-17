/** One-time operator provisioning through existing owner and Controller APIs. */
import { mkdir, writeFile, access } from "node:fs/promises";
const origin = process.env.ATO_API_ORIGIN,
  instance = process.env.ATO_INSTANCE_ID,
  cookie = process.env.ATO_OWNER_SESSION_COOKIE;
if (!origin || !instance || !cookie)
  throw new Error(
    "ATO_API_ORIGIN_ATO_INSTANCE_ID_ATO_OWNER_SESSION_COOKIE_required",
  );
const url = new URL(origin);
if (
  url.protocol !== "https:" &&
  !["localhost", "127.0.0.1"].includes(url.hostname)
)
  throw new Error("https_required");
const output = "../.tmp/controller-session.env";
if (
  await access(output).then(
    () => true,
    () => false,
  )
)
  throw new Error(
    "session_file_exists_use_existing_session_or_archive_it_explicitly",
  );
async function post(
  path: string,
  body: unknown,
  credential?: string,
): Promise<any> {
  const response = await fetch(new URL(path, origin), {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    headers: {
      "content-type": "application/json",
      ...(credential
        ? { Authorization: `Bearer ${credential}` }
        : {
            Cookie: cookie!,
            Origin: process.env.ATO_OWNER_ORIGIN ?? url.origin,
          }),
    },
    body: JSON.stringify(body),
  });
  // Never log an API body: successful responses include credentials.
  if (!response.ok) throw new Error(`provision_failed_${response.status}`);
  return response.json();
}
const attached = await post("/v1/activities", { instance_id: instance });
const activity = attached.activity_id;
if (typeof activity !== "string") throw new Error("invalid_activity_response");
const actor =
  process.env.ATO_ACTOR_ID ??
  (
    await post(`/v1/activities/${encodeURIComponent(activity)}/actors`, {
      display_name: "Plaza Guide",
      execution_profile: "app-room",
      target_run_ids: [attached.application_run_id],
      grant: {
        observe: true,
        interact: true,
        memo_read: false,
        memo_write: false,
        interaction_read: false,
        interaction_write: false,
      },
    })
  ).actor?.id;
if (typeof actor !== "string") throw new Error("invalid_actor_response");
const binding = await post(
  `/v1/activities/${encodeURIComponent(activity)}/actors/${encodeURIComponent(actor)}/controller-bindings`,
  { expires_in_seconds: 3600 },
);
const session = await post(
  "/v1/controller-sessions",
  { controller_kind: "external_mcp" },
  binding.connection.controller_key,
);
if (
  typeof session.controller_session_token !== "string" ||
  !/^atoc_[\w-]+$/.test(session.controller_session_token)
)
  throw new Error("invalid_session_response");
await mkdir("../.tmp", { recursive: true });
await writeFile(
  output,
  `ATO_API_ORIGIN=${url.origin}\nATO_CONTROLLER_SESSION_TOKEN=${session.controller_session_token}\n`,
  { mode: 0o600, flag: "wx" },
);
console.log(
  JSON.stringify({
    instance_id: instance,
    activity_id: activity,
    actor_id: actor,
    session_id: session.session.id,
    environment_file: output,
  }),
);
