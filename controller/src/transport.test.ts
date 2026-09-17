import { afterEach, it, expect, vi } from "vitest";
import { ControllerTransport, type Control, type Fence } from "./transport";
import { templatePost } from "../../src/playground/coop/adapter";
const fence: Fence = {
  session_id: "session",
  session_epoch: 1,
  execution_epoch: 2,
  goal_revision: 3,
  room_epoch: 0,
  executor_id: "executor",
};
const id = "2668e3ca-f0e1-4bbc-a3f8-77facfdc174a",
  op = templatePost("wait", id, 1000);
function transport() {
  const t = new ControllerTransport("http://localhost:8787", "synthetic-token");
  t.control = { actor_id: "ai", fence } as Control;
  return t;
}
const committed = {
  status: "room-committed",
  seq: 1,
  actor_id: "actor:ai",
  op,
};
afterEach(() => vi.unstubAllGlobals());
it("confirms a lost post-commit response without submitting another operation", async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("connection closed"))
    .mockResolvedValueOnce(Response.json(committed));
  vi.stubGlobal("fetch", fetch);
  expect(await transport().post(id, op, fence)).toMatchObject({ seq: 1 });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1][0]).toContain(`/receipt?operation_id=${id}`);
});
it("retries a pre-commit loss once with byte-identical ID, payload and fence", async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("connection closed"))
    .mockResolvedValueOnce(Response.json({ status: "unknown" }))
    .mockResolvedValueOnce(Response.json({ seq: 1 }))
    .mockResolvedValueOnce(Response.json(committed));
  vi.stubGlobal("fetch", fetch);
  await transport().post(id, op, fence);
  expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[2][1].body);
  expect(fetch).toHaveBeenCalledTimes(4);
});
it("refuses different committed payloads and a retry after a stop fence", async () => {
  const t = transport(),
    fetch = vi
      .fn()
      .mockImplementationOnce(async () => {
        t.control = { ...t.control!, fence: { ...fence, execution_epoch: 4 } };
        throw new TypeError("connection closed");
      })
      .mockResolvedValueOnce(Response.json({ status: "unknown" }));
  vi.stubGlobal("fetch", fetch);
  await expect(t.post(id, op, fence)).rejects.toThrow("controller_fenced");
  expect(fetch).toHaveBeenCalledTimes(2);
  fetch
    .mockReset()
    .mockRejectedValueOnce(new TypeError())
    .mockResolvedValueOnce(
      Response.json({ ...committed, op: templatePost("follow", id, 1000) }),
    );
  await expect(transport().post(id, op, fence)).rejects.toThrow(
    "commit_unconfirmed",
  );
});
