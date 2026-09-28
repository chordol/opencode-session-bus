// test/fake-ctx.ts — in-memory `Ctx` double for unit tests.
//
// Structural implementation of Ctx from ../src/types.ts. Every call is recorded
// on `ctx.calls` so tests can assert on what the code under test did. Per-test
// values can be injected through the `overrides` argument.
import type { Ctx, ToolInfo, ToolEditor, DeliveryMode } from "../src/types.js";

export interface PromptRecord {
  kind: "prompt" | "synthetic";
  sessionID: string;
  text: string;
  delivery?: DeliveryMode;
  description?: string;
}

export interface FakeCalls {
  /** Raw input passed to `session.create`, in order. */
  created: Array<{ agent?: string; title?: string; model?: unknown }>;
  prompts: PromptRecord[];
  synthetics: PromptRecord[];
  waited: string[];
  contexts: string[];
  gets: string[];
  registeredTools: ToolInfo[];
  /** Backing store for `ctx.storage`, exposed for assertions/seed inspection. */
  storage: Map<string, unknown>;
}

export interface FakeOverrides {
  /** Fixed context, or a function of sessionID. Default: [] (or `transcript`). */
  context?: ReadonlyArray<any> | ((sessionID: string) => ReadonlyArray<any>);
  /** Seed for the mutable transcript returned by `session.context`. */
  transcript?: ReadonlyArray<any>;
  /**
   * Called synchronously after a `session.prompt` is recorded and (if set)
   * before a `promptError` is thrown. Use it to append a fresh assistant reply,
   * simulating the target session finishing the turn — so `runSibling` /
   * `sendAndWait` observe a NEW message instead of timing out.
   */
  afterPrompt?: (input: { sessionID: string; text: string; delivery?: DeliveryMode }) => void;
  /** Value of `busy` on `session.get`. Default: false (=> idle). */
  busy?: boolean;
  /** Full replacement for `session.get`. */
  get?: (input: { sessionID: string }) => Promise<any> | any;
  /** If set, `session.prompt` rejects with this error. */
  promptError?: unknown;
  /** If set, `session.synthetic` rejects with this error. */
  syntheticError?: unknown;
  /** If set, `session.create` rejects with this error. */
  createError?: unknown;
  /** Seed entries for the Map-backed storage. */
  storageSeed?: Record<string, unknown>;
  session?: Partial<Ctx["session"]>;
  tool?: Partial<Ctx["tool"]>;
  event?: Partial<Ctx["event"]>;
  storage?: Partial<Ctx["storage"]>;
  app?: Ctx["app"];
  rpc?: Ctx["rpc"];
}

export interface FakeCtx extends Ctx {
  calls: FakeCalls;
  /** Replace the mutable transcript returned by `session.context`. */
  setTranscript(messages: ReadonlyArray<any>): void;
  /** Append an arbitrary message to the mutable transcript. */
  appendMessage(message: any): void;
  /**
   * Append a well-formed assistant message matching the real API shape:
   * `{ id, type:"assistant", finish:"stop", time:{ completed }, content:[{type:"text",text}] }`.
   * Returns the message so callers can keep its id as a baseline.
   */
  appendAssistant(
    text: string,
    opts?: { id?: string; finish?: string; completed?: number | false },
  ): any;
}

let assistantSeq = 0;

/** Build one assistant message in the shape `ctx.session.context` really emits. */
export function assistantMessage(
  text: string,
  opts: { id?: string; finish?: string; completed?: number | false } = {},
): any {
  const id = opts.id ?? `msg_assistant_${++assistantSeq}`;
  return {
    id,
    type: "assistant",
    finish: opts.finish ?? "stop",
    time: { completed: opts.completed === undefined ? Date.now() : opts.completed },
    content: [{ type: "text", text }],
  };
}

/** Build an in-memory Ctx with recorded calls and optional overrides. */
export function makeFakeCtx(overrides: FakeOverrides = {}): FakeCtx {
  let createdCount = 0;
  // Mutable backing transcript. `overrides.context` (if provided) still wins.
  const transcript: any[] = [...(overrides.transcript ?? [])];

  const calls: FakeCalls = {
    created: [],
    prompts: [],
    synthetics: [],
    waited: [],
    contexts: [],
    gets: [],
    registeredTools: [],
    storage: new Map<string, unknown>(Object.entries(overrides.storageSeed ?? {})),
  };

  const contextFor = (sessionID: string): ReadonlyArray<any> => {
    if (typeof overrides.context === "function") return overrides.context(sessionID);
    if (overrides.context) return overrides.context;
    return transcript;
  };

  const session: Ctx["session"] = {
    create: async (input: { agent?: string; title?: string; model?: unknown }) => {
      if (overrides.createError) throw overrides.createError;
      calls.created.push({ ...(input ?? {}) });
      const n = ++createdCount;
      // Deliberately no parentID: mirrors a top-level/sibling session.
      return { id: `ses_test_${n}`, title: input?.title, time: { updated: Date.now() } };
    },
    get: async (input) => {
      calls.gets.push(input.sessionID);
      if (overrides.get) return await overrides.get(input);
      return {
        id: input.sessionID,
        title: input.sessionID,
        time: { updated: Date.now() },
        busy: overrides.busy ?? false,
      };
    },
    prompt: async (input) => {
      calls.prompts.push({ kind: "prompt", ...input });
      if (overrides.promptError) throw overrides.promptError;
      overrides.afterPrompt?.(input);
      return { ok: true };
    },
    synthetic: async (input) => {
      calls.synthetics.push({ kind: "synthetic", ...input });
      if (overrides.syntheticError) throw overrides.syntheticError;
      return { ok: true };
    },
    wait: async (input) => {
      calls.waited.push(input.sessionID);
      return { ok: true };
    },
    context: async (input) => {
      calls.contexts.push(input.sessionID);
      return contextFor(input.sessionID);
    },
    interrupt: async () => {},
    update: async () => ({ ok: true }),
    move: async () => ({ ok: true }),
    ...overrides.session,
  };

  const registered: ToolInfo[] = [];
  const editor: ToolEditor = {
    add: (tool: ToolInfo) => {
      registered.push(tool);
      calls.registeredTools.push(tool);
    },
    update: () => {},
    remove: () => {},
    namespace: () => {},
    list: () => registered as unknown as readonly (ToolInfo & { id: string })[],
    get: (id: string) => registered.find((t) => (t as any).id === id) as any,
  };

  const tool: Ctx["tool"] = {
    transform: async (cb: (editor: ToolEditor) => void) => {
      cb(editor);
      return { dispose: async () => {} };
    },
    list: async () => registered as unknown as readonly (ToolInfo & { id: string })[],
    reload: async () => {},
    ...overrides.tool,
  };

  const event: Ctx["event"] = {
    // Ends immediately; tests that need events override `event.subscribe`.
    subscribe: (_options?: { signal?: AbortSignal }) =>
      (async function* emptyEvents() {})(),
    ...overrides.event,
  };

  const store = calls.storage;
  const storage: Ctx["storage"] = {
    get: async (key: string) => store.get(key),
    set: async (key: string, value: unknown) => {
      store.set(key, value);
    },
    remove: async (key: string) => {
      store.delete(key);
    },
    scan: async (options) => {
      const entries = [...store.entries()]
        .filter(([key]) => key.startsWith(options.prefix))
        .map(([key, value]) => ({ key, value }));
      const limit = options.limit ?? entries.length;
      return { entries: entries.slice(0, limit) };
    },
    ...overrides.storage,
  };

  const ctx: FakeCtx = {
    session,
    tool,
    event,
    storage,
    app: overrides.app,
    rpc: overrides.rpc,
    calls,
    setTranscript(messages) {
      transcript.splice(0, transcript.length, ...messages);
    },
    appendMessage(message) {
      transcript.push(message);
    },
    appendAssistant(text, opts) {
      const msg = assistantMessage(text, opts);
      transcript.push(msg);
      return msg;
    },
  };
  return ctx;
}
