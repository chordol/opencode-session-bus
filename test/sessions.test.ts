// test/sessions.test.ts — unit tests for ../src/sessions.js against fake-ctx.
import { test, expect } from "bun:test";
import { makeFakeCtx, assistantMessage } from "./fake-ctx.js";
import {
  createSibling,
  deleteSession,
  lastAssistantText,
  moveSession,
  runSibling,
  sendAndWait,
  setSessionModel,
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

test("createSibling passes a directory as location when given", async () => {
  const ctx = makeFakeCtx({ context: [] });

  const ref = await createSibling(ctx, { title: "worker", directory: "/tmp/target" });

  expect(ref.id).toBe("ses_test_1");
  expect(ctx.calls.created[0].location).toEqual({ directory: "/tmp/target" });
});

test("createSibling omits location when no directory is given", async () => {
  const ctx = makeFakeCtx({ context: [] });

  await createSibling(ctx, { title: "worker" });

  expect("location" in ctx.calls.created[0]).toBe(false);
});

test("createSibling passes the model + variant at create when given", async () => {
  const ctx = makeFakeCtx({ context: [] });

  await createSibling(ctx, { title: "worker", model: { providerID: "openrouter", id: "deepseek/deepseek-v4.1-flash", variant: "low" } });

  expect(ctx.calls.created[0].model).toEqual({ providerID: "openrouter", id: "deepseek/deepseek-v4.1-flash", variant: "low" });
});

test("createSibling omits variant when the model has none", async () => {
  const ctx = makeFakeCtx({ context: [] });

  await createSibling(ctx, { title: "worker", model: { providerID: "openrouter", id: "openai/gpt-6-luna" } });

  expect(ctx.calls.created[0].model).toEqual({ providerID: "openrouter", id: "openai/gpt-6-luna" });
  expect("variant" in (ctx.calls.created[0].model as any)).toBe(false);
});

test("createSibling sends no model when none is given (unchanged behavior)", async () => {
  const ctx = makeFakeCtx({ context: [] });

  await createSibling(ctx, { title: "worker" });

  expect(ctx.calls.created[0].model).toBeUndefined();
});

// setSessionModel -----------------------------------------------------------

test("setSessionModel switches an existing session's model + variant", async () => {
  const ctx = makeFakeCtx();

  const res = await setSessionModel(ctx, {
    sessionID: "ses_child",
    model: { providerID: "openrouter", id: "openai/gpt-6-luna", variant: "low" },
  });

  expect(res).toEqual({ ok: true });
  expect(ctx.calls.switched).toEqual([
    { sessionID: "ses_child", model: { providerID: "openrouter", id: "openai/gpt-6-luna", variant: "low" } },
  ]);
});

test("setSessionModel drops an undefined variant", async () => {
  const ctx = makeFakeCtx();

  await setSessionModel(ctx, { sessionID: "ses_child", model: { providerID: "openrouter", id: "x/y" } });

  const model = ctx.calls.switched[0].model as any;
  expect(model).toEqual({ providerID: "openrouter", id: "x/y" });
  expect("variant" in model).toBe(false);
});

test("setSessionModel requires a sessionID and a providerID/id", async () => {
  const ctx = makeFakeCtx();

  expect((await setSessionModel(ctx, { sessionID: "", model: { providerID: "openrouter", id: "x/y" } })).ok).toBe(false);
  expect((await setSessionModel(ctx, { sessionID: "ses_x", model: { providerID: "", id: "x/y" } })).ok).toBe(false);
  expect((await setSessionModel(ctx, { sessionID: "ses_x", model: { providerID: "openrouter", id: "" } })).ok).toBe(false);
  expect(ctx.calls.switched).toHaveLength(0);
});

test("setSessionModel reports a runtime error without throwing", async () => {
  const ctx = makeFakeCtx({ switchModelError: new Error("no such model") });

  const res = await setSessionModel(ctx, { sessionID: "ses_child", model: { providerID: "openrouter", id: "x/y" } });

  expect(res.ok).toBe(false);
  expect(res.error).toContain("no such model");
});

test("setSessionModel reports unavailability when the runtime has no switchModel", async () => {
  const ctx = makeFakeCtx({ session: { switchModel: undefined } });

  const res = await setSessionModel(ctx, { sessionID: "ses_child", model: { providerID: "openrouter", id: "x/y" } });

  expect(res.ok).toBe(false);
  expect(res.error).toContain("unavailable");
});

test("runSibling threads the model into creation", async () => {
  const ctx = makeFakeCtx({ afterPrompt: () => ctx.appendAssistant("done") });

  await runSibling(ctx, { task: "go", model: { providerID: "openrouter", id: "x/y", variant: "high" }, timeoutMs: 5_000 });

  expect(ctx.calls.created[0].model).toEqual({ providerID: "openrouter", id: "x/y", variant: "high" });
});

// moveSession ---------------------------------------------------------------

test("moveSession calls session.move with the sessionID and directory", async () => {
  const ctx = makeFakeCtx();

  const res = await moveSession(ctx, { sessionID: "ses_other", directory: "/tmp/dest" });

  expect(res).toEqual({ ok: true });
  expect(ctx.calls.moved).toEqual([{ sessionID: "ses_other", directory: "/tmp/dest" }]);
});

test("moveSession requires a sessionID and directory", async () => {
  const ctx = makeFakeCtx();

  expect((await moveSession(ctx, { sessionID: "", directory: "/tmp/dest" })).ok).toBe(false);
  expect((await moveSession(ctx, { sessionID: "ses_x", directory: "" })).ok).toBe(false);
  expect(ctx.calls.moved).toHaveLength(0);
});

test("moveSession reports a runtime error without throwing", async () => {
  const ctx = makeFakeCtx({ moveError: new Error("no such dir") });

  const res = await moveSession(ctx, { sessionID: "ses_other", directory: "/tmp/dest" });

  expect(res.ok).toBe(false);
  expect(res.error).toContain("no such dir");
});

test("moveSession reports unavailability when the runtime has no move", async () => {
  const ctx = makeFakeCtx({ session: { move: undefined } });

  const res = await moveSession(ctx, { sessionID: "ses_other", directory: "/tmp/dest" });

  expect(res.ok).toBe(false);
  expect(res.error).toContain("unavailable");
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

// (f) deleteSession -----------------------------------------------------------

test("deleteSession removes the target session", async () => {
  const ctx = makeFakeCtx();

  const res = await deleteSession(ctx, { sessionID: "ses_other", self: "ses_me" });

  expect(res).toEqual({ ok: true });
  expect(ctx.calls.removed).toEqual(["ses_other"]);
});

test("deleteSession refuses the caller's own session without force", async () => {
  const ctx = makeFakeCtx();

  const res = await deleteSession(ctx, { sessionID: "ses_me", self: "ses_me" });

  expect(res.ok).toBe(false);
  expect(res.error).toContain("own session");
  expect(ctx.calls.removed).toEqual([]);
});

test("deleteSession allows the caller's own session with force", async () => {
  const ctx = makeFakeCtx();

  const res = await deleteSession(ctx, { sessionID: "ses_me", self: "ses_me", force: true });

  expect(res).toEqual({ ok: true });
  expect(ctx.calls.removed).toEqual(["ses_me"]);
});

test("deleteSession requires a sessionID", async () => {
  const ctx = makeFakeCtx();

  const res = await deleteSession(ctx, { sessionID: "" });

  expect(res.ok).toBe(false);
  expect(ctx.calls.removed).toEqual([]);
});

test("deleteSession reports a runtime error without throwing", async () => {
  const ctx = makeFakeCtx({ removeError: new Error("nope") });

  const res = await deleteSession(ctx, { sessionID: "ses_other", self: "ses_me" });

  expect(res.ok).toBe(false);
  expect(res.error).toContain("nope");
});

test("deleteSession reports unavailability when the runtime has no remove", async () => {
  const ctx = makeFakeCtx({ session: { remove: undefined } });

  const res = await deleteSession(ctx, { sessionID: "ses_other", self: "ses_me" });

  expect(res.ok).toBe(false);
  expect(res.error).toContain("unavailable");
});

// ZDR guard ------------------------------------------------------------------

test("createSibling allows an Anthropic model now account ZDR is off for the group", async () => {
  const ctx = makeFakeCtx();

  await createSibling(ctx, { title: "worker", model: { providerID: "openrouter", id: "anthropic/claude-fable-5.2" } });

  expect(ctx.calls.created[0].model).toEqual({ providerID: "openrouter", id: "anthropic/claude-fable-5.2" });
});

test("createSibling allows a ZDR-safe model", async () => {
  const ctx = makeFakeCtx();

  await createSibling(ctx, { title: "worker", model: { providerID: "openrouter", id: "openai/gpt-6-luna" } });

  expect(ctx.calls.created[0].model).toEqual({ providerID: "openrouter", id: "openai/gpt-6-luna" });
});

test("setSessionModel allows an Anthropic model now account ZDR is off for the group", async () => {
  const ctx = makeFakeCtx();

  const res = await setSessionModel(ctx, {
    sessionID: "ses_child",
    model: { providerID: "openrouter", id: "anthropic/claude-fable-5.2" },
  });

  expect(res.ok).toBe(true);
  expect(ctx.calls.switched).toHaveLength(1);
});

test("runSibling surfaces a provider error instead of a silent empty done", async () => {
  const ctx = makeFakeCtx();
  ctx.appendMessage({
    id: "msg_err",
    type: "assistant",
    finish: "error",
    content: [],
    error: {
      type: "provider.invalid-request",
      message: "0 endpoints out of 4 requested are available matching your guardrail restrictions and data policy. ZDR violation (account settings): 4 endpoints excluded",
    },
  });

  const result = await runSibling(ctx, { task: "go", timeoutMs: 500 });

  expect(result.status).toBe("error");
  expect(result.error).toContain("ZDR-safe");
  expect(result.error).toContain("zero-data-retention");
});

test("runSibling passes a non-ZDR provider error through unchanged", async () => {
  const ctx = makeFakeCtx();
  ctx.appendMessage({
    id: "msg_err",
    type: "assistant",
    finish: "error",
    content: [],
    error: { type: "provider.invalid-request", message: "model not found" },
  });

  const result = await runSibling(ctx, { task: "go", timeoutMs: 500 });

  expect(result.status).toBe("error");
  expect(result.error).toBe("model not found");
});
