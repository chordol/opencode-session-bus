// src/sessions.ts — sibling session lifecycle + reply extraction. See docs/DESIGN.md.
// Shapes are grounded in docs/API-REFERENCE.md (verified against @opencode/client@2.0.18).
import type { Ctx, SessionRef, RunResult, DeliveryMode, SessionID } from "./types.js";

/** Sleep helper (Bun + Node both expose a global setTimeout). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Pull a session id out of whichever shape `create`/`list` returns. */
function extractID(raw: any): string | undefined {
  return raw?.id ?? raw?.sessionID ?? raw?.session?.id ?? raw?.info?.id;
}

/** Best-effort title from a session-ish object. */
function extractTitle(raw: any): string | undefined {
  return raw?.title ?? raw?.name ?? raw?.session?.title ?? raw?.info?.title;
}

/**
 * Classify a session's liveness from a `get()` result: true (idle), false (busy),
 * undefined (cannot determine). SessionInfo (docs) sets `outcome` at the terminal
 * transition and records `time.idle`; either means the last run finished.
 */
function detectIdle(s: any): boolean | undefined {
  if (s == null) return undefined;
  if (s.outcome) return true;
  if (s.time && typeof s.time.idle === "number") return true;
  if (typeof s.busy === "boolean") return !s.busy;
  if (typeof s.isBusy === "boolean") return !s.isBusy;
  const rawStatus = s.status ?? s.state ?? s.phase;
  const status =
    typeof rawStatus === "string"
      ? rawStatus
      : typeof rawStatus === "object" && rawStatus !== null
        ? rawStatus.type ?? rawStatus.state ?? rawStatus.name
        : undefined;
  if (typeof status === "string") {
    const v = status.toLowerCase();
    if (["idle", "ready", "done", "complete", "completed", "finished", "stopped"].includes(v)) return true;
    if (["busy", "running", "working", "active", "streaming", "pending", "processing"].includes(v)) return false;
  }
  return undefined;
}

/** Extract plain text from a message whose content shape varies a lot. */
function extractText(msg: any): string | undefined {
  for (const c of [msg?.content, msg?.parts, msg?.message?.content, msg?.message?.parts]) {
    if (typeof c === "string") {
      if (c.trim()) return c;
    } else if (Array.isArray(c)) {
      const texts = c
        .filter((p: any) => p && typeof p.text === "string" && (p.type === "text" || p.type == null))
        .map((p: any) => p.text as string);
      if (texts.join("").length) return texts.join("");
    }
  }
  if (typeof msg?.text === "string" && msg.text.trim()) return msg.text;
  return undefined;
}

/** Read a message's role, tolerating nesting. */
function roleOf(msg: any): string | undefined {
  return msg?.role ?? msg?.info?.role ?? msg?.message?.role ?? (msg?.type === "assistant" ? "assistant" : undefined);
}

/** Normalize any `{messages}`/`{items}`/`{data}`/array response into an array. */
function asArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return asArray(value.messages ?? value.items ?? value.data);
}

/** An assistant message that has finished its turn (not mid tool-call). */
function isCompleteAssistant(msg: any): boolean {
  const finish = msg?.finish;
  if (typeof finish === "string") return finish !== "tool-calls";
  return Boolean(msg?.time?.completed);
}

function messageID(msg: any): string | undefined {
  return msg?.id ?? msg?.messageID ?? msg?.message?.id;
}

async function safeContext(ctx: Ctx, sessionID: SessionID): Promise<any[]> {
  try {
    return asArray(await ctx.session.context({ sessionID }));
  } catch {
    return [];
  }
}

/**
 * Create a new top-level ("sibling") session. No parentID is passed, so the
 * result is a normal session rather than a child subagent.
 */
export async function createSibling(
  ctx: Ctx,
  opts?: { agent?: string; title?: string },
): Promise<SessionRef> {
  const raw = await ctx.session.create({ agent: opts?.agent, title: opts?.title });
  const id = extractID(raw);
  if (!id) throw new Error("session.create returned no session id");
  const title = extractTitle(raw) ?? opts?.title ?? id;
  return { id, title, status: "idle" };
}

/** Send text to a session. `mode` defaults to "steer"; "queue" defers delivery. */
export async function sendPrompt(
  ctx: Ctx,
  sessionID: SessionID,
  text: string,
  mode: DeliveryMode = "steer",
): Promise<void> {
  await ctx.session.prompt({ sessionID, text, delivery: mode });
}

/**
 * Wait until a *new* assistant reply appears after `baseline` message ids and
 * looks complete. Returns its text, or undefined on timeout. This is what makes
 * messaging correct: a session that already has an `outcome` from a prior run
 * must not be mistaken for "the new turn finished".
 */
export async function waitForNewReply(
  ctx: Ctx,
  sessionID: SessionID,
  baseline: Set<string>,
  timeoutMs = 300_000,
): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs;
  let latestFresh: any | undefined;
  for (;;) {
    const msgs = await safeContext(ctx, sessionID);
    const fresh = msgs.filter((m) => roleOf(m) === "assistant" && !baseline.has(messageID(m) ?? ""));
    if (fresh.length) {
      const last = fresh[fresh.length - 1];
      latestFresh = last;
      if (isCompleteAssistant(last)) return extractText(last) ?? "";
    }
    if (Date.now() >= deadline) {
      return latestFresh ? extractText(latestFresh) : undefined;
    }
    await sleep(500);
  }
}

/**
 * Send text, then block for the next assistant reply. `format` is applied to the
 * outgoing text (used by the bus to add a `[from x]` prefix).
 */
export async function sendAndWait(
  ctx: Ctx,
  sessionID: SessionID,
  text: string,
  mode: DeliveryMode = "steer",
  timeoutMs = 300_000,
): Promise<string | undefined> {
  const before = new Set(safe_baseline(await safeContext(ctx, sessionID)));
  await sendPrompt(ctx, sessionID, text, mode);
  return waitForNewReply(ctx, sessionID, before, timeoutMs);
}

function safe_baseline(msgs: any[]): string[] {
  return msgs.map((m) => messageID(m)).filter((x): x is string => typeof x === "string");
}

/** Return the text of the last assistant message in a session, or undefined. */
export async function lastAssistantText(ctx: Ctx, sessionID: SessionID): Promise<string | undefined> {
  const messages = await safeContext(ctx, sessionID);
  for (let i = messages.length - 1; i >= 0; i--) {
    if (roleOf(messages[i]) !== "assistant") continue;
    const text = extractText(messages[i]);
    if (text !== undefined) return text;
  }
  return undefined;
}

/**
 * Wait until a session is idle (bounded). Prefers the purpose-built
 * `ctx.session.wait` (resolves on the next idle transition); falls back to
 * polling `get()` for an outcome/idle marker.
 */
export async function waitIdle(ctx: Ctx, sessionID: SessionID, timeoutMs = 300_000): Promise<boolean> {
  const waitFn = (ctx.session as any).wait;
  if (typeof waitFn === "function") {
    try {
      await Promise.race([
        waitFn.call(ctx.session, { sessionID }),
        sleep(timeoutMs).then(() => {
          throw new Error("timeout");
        }),
      ]);
      return true;
    } catch {
      /* fall through to polling */
    }
  }
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let session: any;
    try {
      session = await ctx.session.get({ sessionID });
    } catch {
      session = undefined;
    }
    if (detectIdle(session) === true) return true;
    if (Date.now() >= deadline) return false;
    await sleep(Math.min(500, Math.max(0, deadline - Date.now())));
  }
}

/**
 * Run a full sibling round-trip: create, send the task, wait for a new completed
 * reply (default 300 s), and return it. Never throws.
 */
export async function runSibling(
  ctx: Ctx,
  opts: { task: string; agent?: string; title?: string; timeoutMs?: number },
): Promise<RunResult> {
  let sessionID = "";
  try {
    const ref = await createSibling(ctx, { agent: opts.agent, title: opts.title });
    sessionID = ref.id;
    await sendPrompt(ctx, ref.id, opts.task);
    const text = await waitForNewReply(ctx, ref.id, new Set(), opts.timeoutMs ?? 300_000);
    if (text === undefined) return { sessionID, status: "timeout" };
    return { sessionID, status: "done", text };
  } catch (err) {
    return { sessionID, status: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Best-effort list of live sessions. `ctx.session` is a Pick that excludes
 * enumeration, so this probes optional extensions and degrades to [].
 */
export async function listSessions(ctx: Ctx): Promise<SessionRef[]> {
  const domain = ctx.session as any;
  const fn = domain.list ?? domain.all ?? domain.sessions ?? domain.scan;
  if (typeof fn !== "function") return [];
  let raw: any;
  try {
    raw = await fn.call(domain);
  } catch {
    return [];
  }
  return asArray(raw)
    .map((s: any): SessionRef | undefined => {
      const id = extractID(s);
      if (!id) return undefined;
      const idle = detectIdle(s);
      return {
        id,
        title: extractTitle(s) ?? id,
        status: idle === true ? "idle" : idle === false ? "busy" : "unknown",
        updated: typeof s?.updated === "number" ? s.updated : typeof s?.time?.updated === "number" ? s.time.updated : undefined,
      };
    })
    .filter((s: SessionRef | undefined): s is SessionRef => s !== undefined);
}
