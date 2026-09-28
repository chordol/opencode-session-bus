// Local, intentionally loose structural types.
// We do NOT import @opencode/plugin at runtime (`define` is identity) so the
// plugin loads with zero module resolution needs. These types only describe
// the subset of the V2 plugin context we use. Verified against
// @opencode/plugin@2.0.18 dist/promise/*.d.ts and @opencode/schema@2.0.18.

export type SessionID = string;
export type DeliveryMode = "steer" | "queue";

export interface SessionRef {
  id: SessionID;
  title: string;
  status: "idle" | "busy" | "unknown";
  updated?: number;
}

export interface RunResult {
  sessionID: SessionID;
  status: "done" | "timeout" | "error";
  text?: string;
  error?: string;
}

export interface ToolContentText { type: "text"; text: string }
export interface ToolContentFile { type: "file"; uri: string; mime: string; name?: string }
export type ToolContent = ToolContentText | ToolContentFile;

export interface ToolResult {
  output?: unknown;
  content?: string | ToolContent[];
  metadata?: Record<string, unknown>;
}

export interface ToolExecContext {
  readonly sessionID: SessionID;
  readonly agent: string;
  readonly messageID: string;
  readonly id: string;
  readonly signal: AbortSignal;
  progress(update: Record<string, unknown>): Promise<void>;
}

export interface ToolInfo {
  name: string;
  description: string;
  input: unknown; // JSON Schema object
  execute(input: any, ctx: ToolExecContext): Promise<ToolResult>;
  options?: { namespace?: string; codemode?: boolean; pinned?: boolean };
}

export interface ToolEditor {
  add(tool: ToolInfo): void;
  update(id: string, update: (tool: ToolInfo) => void): void;
  remove(id: string): void;
  namespace(ns: { name: string; description: string }): void;
  list(): readonly (ToolInfo & { id: string })[];
  get(id: string): (ToolInfo & { id: string }) | undefined;
}

export interface Registration { dispose(): Promise<void> }

export interface Ctx {
  readonly session: {
    create(input: { agent?: string; title?: string; model?: unknown }): Promise<any>;
    get(input: { sessionID: SessionID }): Promise<any>;
    prompt(input: { sessionID: SessionID; text: string; delivery?: DeliveryMode }): Promise<any>;
    synthetic(input: { sessionID: SessionID; text: string; description?: string; delivery?: DeliveryMode }): Promise<any>;
    wait(input: { sessionID: SessionID }): Promise<any>;
    context(input: { sessionID: SessionID }): Promise<ReadonlyArray<any>>;
    interrupt(input: { sessionID: SessionID; continue?: boolean }): Promise<void>;
    update(input: any): Promise<any>;
    move(input: any): Promise<any>;
  };
  readonly tool: {
    transform(cb: (editor: ToolEditor) => void): Promise<Registration>;
    list(): Promise<readonly (ToolInfo & { id: string })[]>;
    reload(): Promise<void>;
  };
  readonly event: {
    subscribe(options?: { signal?: AbortSignal }): AsyncIterable<any>;
  };
  readonly storage: {
    get(key: string): Promise<any>;
    set(key: string, value: any): Promise<void>;
    remove(key: string): Promise<void>;
    scan(options: { prefix: string; after?: string; limit?: number }): Promise<{ entries: ReadonlyArray<{ key: string; value: any }>; next?: string }>;
  };
  readonly app?: { version?: string };
  readonly rpc?: any;
}

export const HOP_LIMIT = 4;
export const BUS_NAMESPACE = "session_bus";
export const REGISTRY_PREFIX = "registry/";
