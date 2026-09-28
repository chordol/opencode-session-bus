// session-bus — sibling messaging + session registry.
// Deterministic message formatting is isolated from I/O so it can be unit
// tested without a live Ctx. All I/O functions swallow errors: callers get
// {ok:false,error} instead of an exception.
import {
  BUS_NAMESPACE,
  HOP_LIMIT,
  REGISTRY_PREFIX,
  type Ctx,
  type DeliveryMode,
  type SessionRef,
} from "./types.js";

/** Registry entries older than this are hidden from listRegistered. */
const REGISTRY_TTL_MS = 24 * 60 * 60 * 1000;

/** Build the outgoing text: `[from <self>] <text>` plus an optional `\n(via: a,b)`. */
export function formatMessage(
  self: string | undefined,
  text: string,
  via?: string[],
): { text: string; via: string[] } {
  const chain = via ?? [];
  let out = `[from ${self ?? "unknown"}] ${text}`;
  if (chain.length > 0) out += `\n(via: ${chain.join(",")})`;
  return { text: out, via: chain };
}

/** Persist a session reference under `registry/<id>` so peers can find it. */
export async function registerSession(
  ctx: Ctx,
  ref: SessionRef,
  role?: string,
): Promise<void> {
  // ASSUMPTION: storage values are arbitrary JSON; adding role/ts is safe.
  await ctx.storage.set(`${REGISTRY_PREFIX}${ref.id}`, {
    ...ref,
    role,
    ts: Date.now(),
  });
}

/** List registered sessions, hiding entries older than 24h. [] if scan unsupported. */
export async function listRegistered(
  ctx: Ctx,
): Promise<Array<SessionRef & { role?: string }>> {
  try {
    // ASSUMPTION: ctx.storage.scan is optional at runtime and may be absent on
    // older builds; fall back to an empty list rather than throwing.
    const scan = (ctx.storage as { scan?: unknown }).scan;
    if (typeof scan !== "function") return [];
    const res = await ctx.storage.scan({ prefix: REGISTRY_PREFIX });
    const now = Date.now();
    const out: Array<SessionRef & { role?: string }> = [];
    for (const entry of res.entries ?? []) {
      const v = entry.value as (SessionRef & { role?: string; ts?: number }) | null;
      if (!v || typeof v.id !== "string") continue;
      if (typeof v.ts === "number" && now - v.ts > REGISTRY_TTL_MS) continue;
      const { ts: _ts, ...ref } = v;
      out.push(ref);
    }
    return out;
  } catch {
    return [];
  }
}

/** Route text to another session, guarding self-sends and hop chains. */
export async function sendToSession(
  ctx: Ctx,
  opts: {
    to: string;
    text: string;
    mode?: DeliveryMode;
    via?: string[];
    self?: string;
  },
): Promise<{ ok: boolean; error?: string }> {
  const { to, text, mode, via, self } = opts;
  if (to === self) return { ok: false, error: "refusing to send to self" };
  if ((via?.length ?? 0) > HOP_LIMIT)
    return { ok: false, error: "hop limit exceeded" };

  const formatted = formatMessage(self, text, via);
  try {
    // ASSUMPTION: `delivery` defaults to "steer" when omitted; we pass it
    // explicitly from mode ?? "steer" per the frozen contract.
    await ctx.session.prompt({
      sessionID: to,
      text: formatted.text,
      delivery: mode ?? "steer",
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Emit a non-prompting synthetic notice into a session (best-effort, no throw). */
export async function pingSession(
  ctx: Ctx,
  sessionID: string,
  text: string,
  description?: string,
): Promise<void> {
  try {
    // ASSUMPTION: synthetic accepts {sessionID,text,description?} exactly as
    // typed in types.ts; unknown description is passed through verbatim.
    await ctx.session.synthetic({ sessionID, text, description });
  } catch {
    // intentionally swallowed — pings are advisory
  }
}

// Re-exported so integrators can price hop chains without importing types.ts.
export { BUS_NAMESPACE, HOP_LIMIT };
