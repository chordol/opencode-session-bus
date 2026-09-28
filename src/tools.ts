// src/tools.ts — registers the session-bus tools on the V2 tool domain.
//
// Tools are built per registration by `makeTools(context)`, closing over that
// location's plugin context, so the plugin is safe when several locations
// (project configs) load it at once.
//
// NOTE: tool results must not set `output` unless the tool declares an `output`
// schema (the runtime rejects it otherwise). We return `content` + `metadata`.
import type { Ctx, ToolInfo, ToolResult } from "./types.js";
import {
  createSibling,
  listSessions,
  lastAssistantText,
  runSibling,
  sendAndWait,
  sendPrompt,
  waitForNewReply,
  waitIdle,
} from "./sessions.js";
import { formatMessage, listRegistered, registerSession, sendToSession } from "./bus.js";

const JSON_OBJ = { type: "object", additionalProperties: false } as const;

/** Build the tool set for one plugin context. */
function makeTools(ctx: Ctx): ToolInfo[] {
  const sessionNew: ToolInfo = {
    name: "session_new",
    description:
      "Start a new top-level (sibling) session — not a child subagent — and give it a task. " +
      "With wait=true (default) it blocks and returns the sibling's final reply. With wait=false " +
      "it returns immediately with a session id and the sibling messages you when it finishes.",
    input: {
      ...JSON_OBJ,
      properties: {
        task: { type: "string", description: "Self-contained instructions for the sibling session." },
        agent: { type: "string", description: "Agent id to run the sibling as (default: the runtime default)." },
        title: { type: "string", description: "Optional session title." },
        wait: { type: "boolean", description: "Block until done (default true)." },
        timeoutMs: { type: "number", description: "Timeout when waiting (default 300000)." },
      },
      required: ["task"],
    },
    async execute(input: any, tctx): Promise<ToolResult> {
      const caller = tctx.sessionID;
      try {
        await registerSession(ctx, { id: caller, title: caller, status: "idle" }, "caller");
      } catch { /* registry is best-effort */ }

      if (input.wait === false) {
        const ref = await createSibling(ctx, { agent: input.agent, title: input.title });
        try { await registerSession(ctx, ref, "sibling"); } catch { /* best-effort */ }
        await sendPrompt(ctx, ref.id, input.task);
        void (async () => {
          try {
            const text = await waitForNewReply(ctx, ref.id, new Set(), input.timeoutMs ?? 300_000);
            await sendToSession(ctx, {
              to: caller,
              self: ref.id,
              text: `Sibling ${ref.id} finished${text ? `:\n${text}` : "."}`,
            });
          } catch { /* completion notice is best-effort */ }
        })();
        return { content: `Started sibling session ${ref.id} in the background. It will message you on completion.`, metadata: { sessionID: ref.id, wait: false } };
      }

      const res = await runSibling(ctx, {
        task: input.task,
        agent: input.agent,
        title: input.title,
        timeoutMs: input.timeoutMs ?? 300_000,
      });
      try {
        await registerSession(ctx, { id: res.sessionID, title: input.title ?? res.sessionID, status: "idle" }, "sibling");
      } catch { /* best-effort */ }
      const body = res.status === "done"
        ? `Sibling ${res.sessionID} finished.\n\n${res.text ?? "(no text reply)"}`
        : `Sibling ${res.sessionID} ${res.status}${res.error ? `: ${res.error}` : ""}`;
      return { content: body, metadata: { sessionID: res.sessionID, status: res.status } };
    },
  };

  const sessionSend: ToolInfo = {
    name: "session_send",
    description:
      "Send a text message to another session in this runtime. The message is delivered as a user turn " +
      "(delivery='steer' interrupts a running turn, 'queue' waits for the next one).",
    input: {
      ...JSON_OBJ,
      properties: {
        to: { type: "string", description: "Target session id (ses_...)." },
        text: { type: "string", description: "Message text." },
        mode: { type: "string", enum: ["steer", "queue"], description: "Delivery mode (default steer)." },
        wait: { type: "boolean", description: "Block for the target's next reply (default false)." },
        timeoutMs: { type: "number", description: "Timeout when waiting (default 300000)." },
      },
      required: ["to", "text"],
    },
    async execute(input: any, tctx): Promise<ToolResult> {
      if (input.wait === true) {
        const formatted = formatMessage(tctx.sessionID, input.text).text;
        const reply = await sendAndWait(ctx, input.to, formatted, input.mode, input.timeoutMs ?? 300_000);
        return {
          content: reply !== undefined ? `Reply from ${input.to}:\n${reply}` : `Sent to ${input.to}; no reply within timeout.`,
          metadata: { to: input.to, ok: true, waited: true, replied: reply !== undefined },
        };
      }
      const res = await sendToSession(ctx, {
        to: input.to,
        text: input.text,
        mode: input.mode,
        self: tctx.sessionID,
      });
      return {
        content: res.ok ? `Sent to ${input.to}.` : `Send failed: ${res.error}`,
        metadata: { to: input.to, ok: res.ok },
      };
    },
  };

  const sessionList: ToolInfo = {
    name: "session_list",
    description: "List sessions registered with session-bus in this runtime, with best-effort busy/idle status.",
    input: { ...JSON_OBJ, properties: {} },
    async execute(_input: any, _tctx): Promise<ToolResult> {
      const registered = await listRegistered(ctx);
      const live = await listSessions(ctx);
      const byID = new Map<string, any>();
      for (const r of registered) byID.set(r.id, { ...r, source: "registry" });
      for (const s of live) byID.set(s.id, { ...s, source: "runtime" });
      const rows = [...byID.values()];
      const text = rows.length
        ? rows.map((r) => `- ${r.id} [${r.status ?? "unknown"}] ${r.role ? `(${r.role}) ` : ""}${r.title ?? ""}`.trim()).join("\n")
        : "No sessions registered and runtime enumeration is unavailable. Pass session ids directly to session_send/session_read.";
      return { content: text, metadata: { count: rows.length } };
    },
  };

  const sessionRead: ToolInfo = {
    name: "session_read",
    description: "Read the last assistant reply from another session.",
    input: {
      ...JSON_OBJ,
      properties: { sessionID: { type: "string", description: "Session id to read." } },
      required: ["sessionID"],
    },
    async execute(input: any, _tctx): Promise<ToolResult> {
      const text = await lastAssistantText(ctx, input.sessionID);
      return {
        content: text ?? `(no assistant text found in ${input.sessionID})`,
        metadata: { sessionID: input.sessionID },
      };
    },
  };

  const sessionWait: ToolInfo = {
    name: "session_wait",
    description: "Wait until another session becomes idle (bounded by timeoutMs).",
    input: {
      ...JSON_OBJ,
      properties: {
        sessionID: { type: "string", description: "Session id to wait on." },
        timeoutMs: { type: "number", description: "Timeout (default 300000)." },
      },
      required: ["sessionID"],
    },
    async execute(input: any, _tctx): Promise<ToolResult> {
      const idle = await waitIdle(ctx, input.sessionID, input.timeoutMs ?? 300_000);
      return { content: idle ? `Session ${input.sessionID} is idle.` : `Timed out waiting for ${input.sessionID}.`, metadata: { sessionID: input.sessionID, idle } };
    },
  };

  return [sessionNew, sessionSend, sessionList, sessionRead, sessionWait];
}

/** Register all session-bus tools for this location. */
export async function registerTools(context: Ctx): Promise<void> {
  const registration = await context.tool.transform((editor) => {
    for (const tool of makeTools(context)) editor.add(tool);
  });
  // Keep the registration alive for the plugin's lifetime.
  void registration;
}