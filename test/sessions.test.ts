// test/sessions.test.ts — unit tests for ../src/sessions.js against fake-ctx.
import { test, expect } from "bun:test";
import { makeFakeCtx, assistantMessage } from "./fake-ctx.js";
import {
  createSibling,
  lastAssistantText,
  runSibling,
  sendAndWait,
  waitForNewReply,
} from "../src/sessions.js";

// (a) Sibling creation -------------------------------------------------------

test("createSibling yields a session with no parentID", async () => {
  const ctx = makeFakeCtx({ context: [] });

  const ref = await createSibling(ctx, { title: "worker" });

  expect(ref.id).toBe("ses_test_1");
  expect(ref.status).toBe("idle");

  // The create call must not carry a parentID (top-level/sibling, not a child).
  expect(ctx.calls.created).toHaveLength(1);
  expect("parentID" in ctx.calls.created[0]).toBe(false);
  expect(ctx.calls.created[0]).toEqual({ agent: undefined, title: "worker" });
});

// (b) lastAssistantText across content shapes --------------------------------

test("lastAssistantText reads string content", async () => {
  const ctx = makeFakeCtx({
    context: [
      { role: "user", content: "hi" },
      { role: "assistant", content: "plain reply" },
    ],
  });

  expect(await lastAssistantText(ctx, "ses_test_1")).toBe("plain reply");
});

test("lastAssistantText reads a parts array", async () => {
  const ctx = makeFakeCtx({
    context: [
      { role: "user", content: "hi" },
      {
        info: { role: "assistant" },
        parts: [
          { type: "text", text: "part one" },
          { type: "text", text: "part two" },
        ],
      },
    ],
  });

  expect(await lastAssistantText(ctx, "ses_test_1")).toBe("part onepart two");
});

test("lastAssistantText reads a {type:'text'} content array", async () => {
  const ctx = makeFakeCtx({
    context: [
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "text", text: "block reply" }] },
    ],
  });

  expect(await lastAssistantText(ctx, "ses_test_1")).toBe("block reply");
});

test("lastAssistantText reads a real-API assistant message", async () => {
  // Exact shape ctx.session.context emits in the V2 API.
  const ctx = makeFakeCtx({
    transcript: [
      { id: "msg_user_1", type: "user", content: [{ type: "text", text: "hi" }] },
      assistantMessage("api-shaped reply", { id: "msg_assistant_1" }),
    ],
  });

  expect(await lastAssistantText(ctx, "ses_test_1")).toBe("api-shaped reply");
});

test("lastAssistantText returns the FINAL assistant message", async () => {
  const ctx = makeFakeCtx({
    context: [
      { role: "assistant", content: "first" },
      { role: "user", content: "and?" },
      { role: "assistant", content: "last" },
    ],
  });

  expect(await lastAssistantText(ctx, "ses_test_1")).toBe("last");
});

test("lastAssistantText returns undefined when no assistant message exists", async () => {
  const ctx = makeFakeCtx({ context: [{ role: "user", content: "hi" }] });
  expect(await lastAssistantText(ctx, "ses_test_1")).toBeUndefined();
});

// waitForNewReply ------------------------------------------------------------

test("waitForNewReply ignores baseline ids and returns the fresh reply", async () => {
  const old = assistantMessage("old reply", { id: "msg_old" });
  const fresh = assistantMessage("fresh reply", { id: "msg_new" });
  const ctx = makeFakeCtx({ transcript: [old, fresh] });

  const text = await waitForNewReply(ctx, "ses_test_1", new Set(["msg_old"]), 2_000);

  expect(text).toBe("fresh reply");
});

// (c) runSibling success -----------------------------------------------------

test("runSibling returns done with text on success", async () => {
  const ctx = makeFakeCtx({
    // The model finishes only after the task is sent.
    afterPrompt: () => ctx.appendAssistant("task complete"),
  });

  const result = await runSibling(ctx, { task: "do the thing", timeoutMs: 5_000 });

  expect(result.status).toBe("done");
  expect(result.sessionID).toBe("ses_test_1");
  expect(result.text).toBe("task complete");
  // The task was sent to the new sibling.
  expect(ctx.calls.prompts).toHaveLength(1);
  expect(ctx.calls.prompts[0].sessionID).toBe("ses_test_1");
});

// (d) runSibling timeout -----------------------------------------------------

test("runSibling returns timeout when no fresh reply arrives", async () => {
  const ctx = makeFakeCtx({ transcript: [] });

  const result = await runSibling(ctx, { task: "do the thing", timeoutMs: 60 });

  expect(result.status).toBe("timeout");
  expect(result.text).toBeUndefined();
  expect(result.sessionID).toBe("ses_test_1");
});

// runSibling error -----------------------------------------------------------

test("runSibling returns error when prompt throws", async () => {
  const ctx = makeFakeCtx({ promptError: new Error("prompt exploded") });

  const result = await runSibling(ctx, { task: "do the thing", timeoutMs: 5_000 });

  expect(result.status).toBe("error");
  expect(result.error).toContain("prompt exploded");
});

// (e) sendAndWait returns the NEW reply --------------------------------------

test("sendAndWait returns the new reply, not the pre-existing one", async () => {
  const baseline = assistantMessage("pre-existing reply", { id: "msg_baseline" });
  const ctx = makeFakeCtx({
    transcript: [baseline],
    afterPrompt: () => ctx.appendAssistant("the new reply", { id: "msg_reply" }),
  });

  const text = await sendAndWait(ctx, "ses_test_1", "hello", "steer", 2_000);

  expect(text).toBe("the new reply");
  expect(text).not.toBe("pre-existing reply");
  // The outgoing text was delivered as-is (no bus formatting here).
  expect(ctx.calls.prompts).toHaveLength(1);
  expect(ctx.calls.prompts[0].sessionID).toBe("ses_test_1");
  expect(ctx.calls.prompts[0].text).toBe("hello");
});

test("sendAndWait returns undefined when only the baseline exists", async () => {
  const ctx = makeFakeCtx({
    transcript: [assistantMessage("pre-existing reply", { id: "msg_baseline" })],
  });

  const text = await sendAndWait(ctx, "ses_test_1", "hello", "steer", 60);

  expect(text).toBeUndefined();
});
