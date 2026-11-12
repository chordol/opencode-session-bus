// test/tools.test.ts — tool-surface tests for the model/effort arguments.
import { test, expect } from "bun:test";
import { makeFakeCtx } from "./fake-ctx.js";
import { registerTools } from "../src/tools.js";
import type { ToolExecContext, ToolInfo } from "../src/types.js";

function tctx(sessionID: string): ToolExecContext {
  return {
    sessionID,
    agent: "test",
    messageID: "msg_1",
    id: "call_1",
    signal: new AbortController().signal,
    progress: async () => {},
  };
}

function toolNamed(ctx: ReturnType<typeof makeFakeCtx>, name: string): ToolInfo {
  const t = ctx.calls.registeredTools.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} was not registered`);
  return t;
}

test("registerTools registers session_model alongside the rest", async () => {
  const ctx = makeFakeCtx();
  await registerTools(ctx);

  const names = ctx.calls.registeredTools.map((t) => t.name).sort();
  expect(names).toEqual([
    "session_delete",
    "session_list",
    "session_model",
    "session_move",
    "session_new",
    "session_read",
    "session_send",
    "session_wait",
  ]);
});

test("session_new passes the model at create (wait branch)", async () => {
  const ctx = makeFakeCtx({ afterPrompt: () => ctx.appendAssistant("done") });
  await registerTools(ctx);

  const tool = toolNamed(ctx, "session_new");
  await tool.execute(
    { task: "go", model: { providerID: "openrouter", id: "deepseek/deepseek-v4.1-flash", variant: "low" }, timeoutMs: 5_000 },
    tctx("ses_me"),
  );

  expect(ctx.calls.created[0].model).toEqual({ providerID: "openrouter", id: "deepseek/deepseek-v4.1-flash", variant: "low" });
});

test("session_new passes the model at create (background branch)", async () => {
  const ctx = makeFakeCtx();
  await registerTools(ctx);

  const tool = toolNamed(ctx, "session_new");
  await tool.execute(
    { task: "go", wait: false, model: { providerID: "openrouter", id: "openai/gpt-6-luna" } },
    tctx("ses_me"),
  );

  expect(ctx.calls.created[0].model).toEqual({ providerID: "openrouter", id: "openai/gpt-6-luna" });
});

test("session_new sends no model when none is given", async () => {
  const ctx = makeFakeCtx({ afterPrompt: () => ctx.appendAssistant("done") });
  await registerTools(ctx);

  const tool = toolNamed(ctx, "session_new");
  await tool.execute({ task: "go", timeoutMs: 5_000 }, tctx("ses_me"));

  expect(ctx.calls.created[0].model).toBeUndefined();
});

test("session_model switches an existing session through the tool", async () => {
  const ctx = makeFakeCtx();
  await registerTools(ctx);

  const tool = toolNamed(ctx, "session_model");
  const res = await tool.execute(
    { sessionID: "ses_child", providerID: "openai", id: "gpt-6-luna", variant: "high" },
    tctx("ses_me"),
  );

  expect(ctx.calls.switched).toEqual([
    { sessionID: "ses_child", model: { providerID: "openai", id: "gpt-6-luna", variant: "high" } },
  ]);
  expect((res.metadata as any).ok).toBe(true);
});

test("session_new refuses a model with no ZDR endpoint, legibly", async () => {
  const ctx = makeFakeCtx();
  await registerTools(ctx);

  const tool = toolNamed(ctx, "session_new");
  const res = await tool.execute(
    { task: "go", model: { providerID: "openrouter", id: "anthropic/claude-fable-5.2" } },
    tctx("ses_me"),
  );

  expect(String(res.content)).toContain("ZDR-safe");
  expect(ctx.calls.created).toHaveLength(0);
});

test("session_model refuses a model with no ZDR endpoint, legibly", async () => {
  const ctx = makeFakeCtx();
  await registerTools(ctx);

  const tool = toolNamed(ctx, "session_model");
  const res = await tool.execute(
    { sessionID: "ses_child", providerID: "openrouter", id: "anthropic/claude-fable-5.2" },
    tctx("ses_me"),
  );

  expect((res.metadata as any).ok).toBe(false);
  expect(String(res.content)).toContain("ZDR-safe");
  expect(ctx.calls.switched).toHaveLength(0);
});
