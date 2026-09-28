# API reference — OpenCode v2.0.18 plugin session API

Resolved by unpacking `@opencode/plugin@2.0.18`, `@opencode/client@2.0.18`, and
`@opencode/schema@2.0.18` from npm and reading their `.d.ts`, plus the V2 docs at
`https://opencode.ai/v2/docs/build/plugins/` and `https://opencode.ai/v2/docs/plugins/`.

Context shape: `ctx.session` is `SessionDomain`, a `Pick` of the generated client
`SessionApi`, plus a `hook` method. `ctx.event` is `Pick<EventApi, "subscribe">`.

> `@opencode/plugin/dist/promise/session.d.ts`
> ```ts
> export type SessionDomain = Pick<SessionApi,
>   "create" | "get" | "switchAgent" | "switchModel" | "prompt" | "generate" |
>   "command" | "synthetic" | "interrupt" | "update" | "move" | "wait" | "context">
>   & { readonly hook: ModelHooks<SessionHooks> };
> ```

---

## Q1. `ctx.session.create` input fields

**Answer:** `create(input?)` takes `{ id?, title?, agent?, model?, location?, metadata?, permissions? }` — there is **no** `parentID` (or any parent field) in the create input; `parentID` only appears on the returned `SessionInfo`.

Quoted signature (`@opencode/client@2.0.18` → `dist/promise/generated/client.d.ts`):
```ts
create: (input?: SessionCreateInput, requestOptions?: RequestOptions) => Promise<SessionInfo>;
```
The input type (`@opencode/client@2.0.18` → `dist/promise/generated/types.d.ts`, line 3705) is the codegen form `{ id?: {...}["id"]; title?: {...}["title"]; agent?: {...}["agent"]; model?: {...}["model"]; location?: {...}["location"]; metadata?: {...}["metadata"]; permissions?: {...}["permissions"] }`; the inner object (which is also the effective field type) is:
```ts
{
  readonly id?: string | null;
  readonly title?: string | null;
  readonly agent?: string | null;
  readonly model?: { readonly id: string; readonly providerID: string; readonly variant?: string } | null;
  readonly location?: { readonly directory: string } | null;
  readonly metadata?: { readonly [x: string]: JsonValue } | null;
  readonly permissions?: ReadonlyArray<{ readonly action: string; readonly resource: string; readonly effect: "allow" | "deny" | "ask" }> | null;
}
```
(`grep -i parent` over lines 3705–3853 → no match.) Return type `SessionInfo` **does** carry `parentID?: string` (types.d.ts line 2788; schema `dist/session.d.ts` `Session.Info`).

---

## Q2. `ctx.session.prompt` input fields and return type

**Answer:** `prompt(input)` takes `{ sessionID, id?, text, files?, agents?, skills?, metadata?, delivery?, resume? }` (i.e. `{ sessionID } & PromptInput.Prompt`); it returns `Promise<SessionInboxUser>`.

Quoted signature (`@opencode/client@2.0.18` → `dist/promise/generated/client.d.ts`):
```ts
prompt: (input: SessionPromptInput, requestOptions?: RequestOptions) => Promise<SessionInboxUser>;
```
Input inner struct (`dist/promise/generated/types.d.ts`, line 5385):
```ts
{
  readonly id?: string | null;
  readonly text: string;
  readonly files?: ReadonlyArray<{ readonly uri: string; readonly name?: string; readonly description?: string;
    readonly mention?: { readonly start: number; readonly end: number; readonly text: string } }>;
  readonly agents?: ReadonlyArray<{ readonly name: string; readonly mention?: {...} }>;
  readonly skills?: ReadonlyArray<{ readonly id: string; readonly mention?: {...} }>;
  readonly metadata?: { readonly [x: string]: JsonValue };
  readonly delivery?: ("steer" | "queue") | null;
  readonly resume?: boolean | null;
}
```
Return `SessionInboxUser` (types.d.ts line 3110):
```ts
{ id: string; sessionID: string; time: { created: number }; type: "user";
  payload: SessionInboxUserPayload; delivery: SessionInboxDelivery }
```
where `SessionInboxDelivery = "steer" | "queue"` (types.d.ts line 263; schema `dist/session-inbox.d.ts`: `Delivery = Literals<["steer","queue"]>`).

---

## Q3. `ctx.session.synthetic` input fields and return type

**Answer:** `synthetic(input)` takes `{ sessionID, id?, text, description?, metadata?, delivery?, resume? }`; it returns `Promise<SessionInboxSynthetic>`.

Quoted signature (`@opencode/client@2.0.18` → `dist/promise/generated/client.d.ts`):
```ts
synthetic: (input: SessionSyntheticInput, requestOptions?: RequestOptions) => Promise<SessionInboxSynthetic>;
```
Input inner struct (`dist/promise/generated/types.d.ts`, line 5879):
```ts
{
  readonly id?: string | null;
  readonly text: string;
  readonly description?: string | null;
  readonly metadata?: { readonly [x: string]: JsonValue };
  readonly delivery?: ("steer" | "queue") | null;
  readonly resume?: boolean | null;
}
```
Return `SessionInboxSynthetic` (types.d.ts line 866):
```ts
{ id: string; sessionID: string; time: { created: number }; type: "synthetic";
  payload: SessionInboxSyntheticPayload; delivery: SessionInboxDelivery }
```
with `SessionInboxSyntheticPayload = { text: string; description?: string; metadata?: Record<string, JsonValue> }` (types.d.ts line 264).

---

## Q4. `ctx.session.wait` input fields and return type

**Answer:** `wait(input)` takes exactly `{ sessionID: string }` and returns `Promise<void>`; it resolves when the session next reaches idle. No timeout/duration field exists on the input.

Quoted signature (`@opencode/client@2.0.18` → `dist/promise/generated/client.d.ts`):
```ts
wait: (input: SessionWaitInput, requestOptions?: RequestOptions) => Promise<void>;
```
Input (`dist/promise/generated/types.d.ts`, line 5977):
```ts
export type SessionWaitInput = { readonly sessionID: { readonly sessionID: string }["sessionID"] }; // -> { sessionID: string }
export type SessionWaitOutput = void;
```
A timeout is **not** part of the API; pass a `requestOptions` (with `signal`/timeout) if the transport supports cancellation — UNKNOWN whether `wait` honors it (docs show only `await ctx.session.wait({ sessionID })`). Implement `timeoutMs` client-side (e.g. `Promise.race` / `AbortSignal.timeout`).

---

## Q5. `ctx.session.context` return type — message shape and final assistant text

**Answer:** `context` returns `Promise<readonly SessionMessageInfo[]>`, a union of message kinds. An assistant message has `content: Array<text|reasoning|tool>`; to get the final assistant text, take the last message with `type === "assistant"` and join its parts where `part.type === "text"` (`part.text`).

Quoted signature (`@opencode/client@2.0.18` → `dist/promise/generated/client.d.ts`):
```ts
context: (input: SessionContextInput, requestOptions?: RequestOptions) => Promise<readonly SessionMessageInfo[]>;
```
Input is `{ sessionID: string }`; output alias (`dist/promise/generated/types.d.ts`, line 3256):
```ts
export type SessionMessageInfo =
  SessionMessageAgentSelected | SessionMessageModelSelected | SessionMessageLocationSwitched |
  SessionMessageUser | SessionMessageSynthetic | SessionMessageSystem | SessionMessageSkill |
  SessionMessageShell | SessionMessageAssistant | SessionMessageCompaction | SessionMessageIdle;
```
Assistant message (types.d.ts line 3195):
```ts
export type SessionMessageAssistant = {
  id: string; type: "assistant"; agent: string; model: ModelRef;
  content: Array<SessionMessageAssistantText | SessionMessageAssistantReasoning | SessionMessageAssistantTool>;
  finish?: "stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown";
  error?: SessionStructuredError; time: { created: number; streamed?: number; completed?: number };
  /* + metadata, snapshot, rawFinish, providerState, cost, tokens, retry */
};
export type SessionMessageAssistantText = { type: "text"; text: string; state?: SessionMessageProviderState };
```
`SessionMessageIdle = { id; time: {created}; type: "idle"; outcome: "succeeded" | "failed" | "interrupted" }` (types.d.ts line 249). Schema equivalents: `@opencode/schema@2.0.18` → `dist/session-message.d.ts` (`Assistant.content` is a tagged union on `type`; `AssistantText.type = "text"`; `Idle.outcome`).

Suggested implementation for `lastAssistantText`:
```ts
const msgs = await ctx.session.context({ sessionID });
const last = msgs.filter(m => m.type === "assistant").at(-1);
return last?.content.filter(p => p.type === "text").map(p => p.text).join("");
```

---

## Q6. `ctx.session.get` return type — busy vs idle

**Answer:** `get` returns `Promise<SessionInfo>`, which has **no status field**. The authoritative live signal is the `session.status` event (`status.type` is `"idle" | "busy" | "retry"`) and the `session.idle` event; without events you can derive it from `SessionInfo.time.idle` / `time.updated` / `outcome`.

Quoted signature (`@opencode/client@2.0.18` → `dist/promise/generated/client.d.ts`):
```ts
get: (input: SessionGetInput, requestOptions?: RequestOptions) => Promise<SessionInfo>; // input: { sessionID }
```
`SessionInfo` (`@opencode/client@2.0.18` → `dist/promise/generated/types.d.ts`, line 2788; canonical schema `@opencode/schema@2.0.18` → `dist/session.d.ts` `Session.Info`):
```ts
export type SessionInfo = {
  id: string; parentID?: string; projectID: string; agent?: string; model?: ModelRef;
  cost: MoneyUSD; tokens: TokenUsageInfo;
  outcome?: "succeeded" | "failed" | "interrupted";
  time: { created: number; updated: number; idle?: number; viewed?: number; archived?: number };
  title?: string; subpath?: string; metadata?: SessionMetadata;
  permissions?: PermissionRuleset; revert?: SessionRevert; location: LocationPublicRef;
};
```
Schema comment (`dist/session.d.ts`): *"Outcome of the last completed execution, recorded at `time.idle`. Absent until a run reaches a terminal transition."* So a practical heuristic is: **idle** when `outcome` is set (and/or `time.idle` is present and `>= time.updated`), otherwise **busy**. Prefer the events for correctness:
```ts
// session.status
{ sessionID: string; status: { type: "idle" } | { type: "retry"; attempt; message; action?; next } | { type: "busy" } }
// session.idle
{ sessionID: string }
```
(`@opencode/schema@2.0.18` → `dist/session-status-event.d.ts`, `Status`/`Idle`; client alias `SessionStatus` at types.d.ts line 579, `SessionStatusUpdated` line 2405, `SessionIdle` line 1745.) The client's `session.active()` endpoint also returns `{ [sessionID]: { type: "running" } }`, but it is **not** exposed on `ctx.session` (the `SessionDomain` Pick excludes `active`). The `SessionInfo.time` heuristic is inferred, not a documented API — treat as UNKNOWN if strict correctness is required.

---

## Q7. `ctx.event.subscribe` yields what event type; is there a `session.idle` event and its payload?

**Answer:** It yields the union client event type (`OpenCodeEvent` / `V2Event`). Yes, `session.idle` exists with payload `data: { sessionID: string }`; `session.status` carries `data: { sessionID, status }`.

Quoted signatures:
```ts
// @opencode/plugin@2.0.18 → dist/promise/event.d.ts
export interface EventDomain extends Pick<EventApi, "subscribe"> {}
// @opencode/client@2.0.18 → dist/promise/client.d.ts (OpenCode.make(...).event)
event: { subscribe(options?: SharedEvents.SubscribeOptions): AsyncIterable<import("./index.js").V2Event> };
```
Docs (`/v2/docs/build/plugins/`): `interface EventContext { subscribe(options?: { signal?: AbortSignal }): AsyncIterable<OpenCodeEvent> }`. `V2Event` union is in `@opencode/client@2.0.18` → `dist/promise/generated/types.d.ts` line 3310 and includes `SessionStatusUpdated` and `SessionIdle`.

`session.idle` (types.d.ts line 1745):
```ts
export type SessionIdle = {
  id: string; created: number; metadata?: { [x: string]: any };
  type: "session.idle"; location?: LocationRef;
  data: { sessionID: string };
};
```
`session.status` (types.d.ts line 2405, `SessionStatus` line 579):
```ts
export type SessionStatusUpdated = {
  id: string; created: number; metadata?: { [x: string]: any };
  type: "session.status"; location?: LocationRef;
  data: { sessionID: string; status: SessionStatus };
};
export type SessionStatus =
  | { type: "idle" }
  | { type: "retry"; attempt: number; message: string; action?: {...}; next: number }
  | { type: "busy" };
```
Consumption (docs pattern): abort the stream during cleanup:
```ts
const controller = new AbortController();
for await (const event of ctx.event.subscribe({ signal: controller.signal })) { /* event.type */ }
return () => controller.abort();
```

---

## Q8. Plugin discovery/loading in v2.0.18

**Answer:** Config key is **`plugins`** (array of `string | { package, options }`) in `opencode.json(c)`. Global plugin directory is **`~/.config/opencode/plugins/`**. A plugin does **not** have to import `@opencode/plugin` at runtime — the runtime does not inject the package, but `define` is the identity function, so a plain default-exported `{ id, setup }` object works.

Config key (docs `/v2/docs/plugins/`, "Configure"):
```jsonc
{ "plugins": [ "opencode-acme-plugin", "./plugins/local", { "package": "@acme/opencode-plugin", "options": {} } ] }
```
Schema confirms the field (`@opencode/schema@2.0.18` → `dist/config.d.ts`, line 74): `readonly plugins: optional<Array<Union<[String, ConfigPlugin.Entry]>>>`; `ConfigPlugin.Entry = { package: string; options?: Record<string, unknown> }` (`dist/config/plugin.d.ts`).

Global directory (docs `/v2/docs/plugins/`, "Discover"): *"Global plugins use the same discovery layout under the OpenCode config directory."* →
```text
~/.config/opencode/plugins/
  ├── concise.ts
  ├── reviewer.js
  └── acme-package/
```
Discovery rules, verbatim from the docs: *"OpenCode also loads direct `.ts` and `.js` files and immediate plugin package directories from every discovered `.opencode/plugins/` directory."* A package directory's entrypoint is resolved in order `server`, then the directory itself (`index.*`), then `tui`, then `rpc` (`@opencode/plugin@2.0.18` → `dist/host.js`):
```ts
// host.js
return { server: entry(["server", ""]), tui: entry(["tui"]), rpc: entry(["rpc"]) };
```
So `~/.config/opencode/plugins/session-bus/` should expose `index.ts` (or `server.ts`) default-exporting the plugin object.

Runtime supply of `@opencode/plugin`: **NO** — the package is not injected. `define` is pure identity (`@opencode/plugin@2.0.18` → `dist/promise/plugin.js`):
```ts
export function define(plugin) { return plugin; }
```
Only the TUI subpath is injected as a runtime module: the binary registers `additional: { "@opencode/plugin/tui": { Plugin, PluginContextProvider, usePlugin } }`. Therefore `import { Plugin } from "@opencode/plugin"` only works if the package is resolvable from the plugin's own `node_modules` (e.g. installed as a dependency); it is optional. The docs' `Plugin.define({...})` and the CONTRACT's plain `export default { id, setup }` are equivalent at runtime.

Config locations (docs, lowest→highest precedence):
```text
~/.config/opencode/opencode.jsonc
./opencode.jsonc
./.opencode/opencode.jsonc
```

---

## Side facts confirmed while resolving

- `ctx.tool.transform(cb)` → `Promise<Registration>`, `Registration.dispose(): Promise<void>`; the editor callback is synchronous (`@opencode/plugin@2.0.18` → `dist/promise/registration.d.ts`). Tool `execute(input, context)` returns `Promise<Tool.Result<Output>>`; `ToolContext` extends `Tool.Context` minus `progress`, plus `signal: AbortSignal` and `progress(update)` (`dist/promise/tool.d.ts`). Note the plugin `ToolDomain.transform` returns a Promise, while the CONTRACT text writes `ctx.tool.transform(editor => ...)` — call it with `await`.
- `Interrupt` input: `SessionInterruptInput` (client-generated). `Update`/`Move` exist on `ctx.session` but the docs call rename `ctx.session.rename`; the client API's actual method is `update` (`SessionUpdateInput`), so use `ctx.session.update`.
