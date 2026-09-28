// test/bus.test.ts — unit tests for ../src/bus.js against fake-ctx.
import { test, expect } from "bun:test";
import { makeFakeCtx } from "./fake-ctx.js";
import { formatMessage, sendToSession } from "../src/bus.js";

test("formatMessage prefixes [from X] and appends (via: ...)", () => {
  const { text, via } = formatMessage("ses_a", "hello", ["ses_b", "ses_c"]);

  expect(text).toContain("[from ses_a] hello");
  expect(text).toContain("(via: ses_b,ses_c)");
  expect(via).toEqual(["ses_b", "ses_c"]);
});

test("formatMessage omits the via suffix when there is no chain", () => {
  const { text } = formatMessage("ses_a", "hello");
  expect(text).toBe("[from ses_a] hello");
});

test("sendToSession refuses to send to self", async () => {
  const ctx = makeFakeCtx();

  const res = await sendToSession(ctx, { to: "ses_a", self: "ses_a", text: "hi" });

  expect(res.ok).toBe(false);
  expect(ctx.calls.prompts).toHaveLength(0);
});

test("sendToSession refuses when via chain is longer than 4", async () => {
  const ctx = makeFakeCtx();

  const res = await sendToSession(ctx, {
    to: "ses_target",
    self: "ses_a",
    text: "hi",
    via: ["n1", "n2", "n3", "n4", "n5"],
  });

  expect(res.ok).toBe(false);
  expect((res as { error?: string }).error).toContain("hop");
  expect(ctx.calls.prompts).toHaveLength(0);
});

test("sendToSession prefixes the delivered text with [from X]", async () => {
  const ctx = makeFakeCtx();

  const res = await sendToSession(ctx, { to: "ses_b", self: "ses_a", text: "hello" });

  expect(res.ok).toBe(true);
  expect(ctx.calls.prompts).toHaveLength(1);
  expect(ctx.calls.prompts[0].text).toContain("[from ses_a] hello");
});

test("sendToSession calls prompt with the right sessionID and delivery", async () => {
  const ctx = makeFakeCtx();

  await sendToSession(ctx, { to: "ses_b", self: "ses_a", text: "queued", mode: "queue" });

  expect(ctx.calls.prompts[0].sessionID).toBe("ses_b");
  expect(ctx.calls.prompts[0].delivery).toBe("queue");
});

test("sendToSession defaults delivery to steer", async () => {
  const ctx = makeFakeCtx();

  await sendToSession(ctx, { to: "ses_b", self: "ses_a", text: "now" });

  expect(ctx.calls.prompts[0].delivery).toBe("steer");
});

test("sendToSession returns {ok:false} when prompt throws", async () => {
  const ctx = makeFakeCtx({ promptError: new Error("no route to host") });

  const res = await sendToSession(ctx, { to: "ses_b", self: "ses_a", text: "hi" });

  expect(res.ok).toBe(false);
  expect(res.error).toContain("no route to host");
});
