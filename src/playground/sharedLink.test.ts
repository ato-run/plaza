import { it, expect } from "vitest";
import { sharedLink, postOp } from "./roomProtocol";
it("recognizes real public details and keeps Instance/private/foreign links out", () => {
  for (const detail of ["discover:oss_sample", "capsule:oss_sample"])
    expect(
      sharedLink(`Try https://ato.run/?view=discover&detail=${detail}`),
    ).toEqual({ kind: "app", ref: "oss_sample" });
  expect(sharedLink("https://stg.ato.run/activity/act_test")).toEqual({
    kind: "activity",
    ref: "act_test",
  });
  for (const link of [
    "https://evil.example/?detail=discover:oss_sample",
    "https://ato.run.evil.example/?detail=discover:oss_sample",
    "https://ato.run/?detail=instance:cinst_private",
    "http://ato.run/?detail=discover:oss_sample",
  ])
    expect(sharedLink(link)).toBeNull();
  expect(
    postOp("https://ato.run/?detail=discover:oss_sample", "central-plaza").op,
  ).toMatchObject({ t: "post", post: { app_ref: "oss_sample" } });
});
