# Design

`session-bus` is an OpenCode V2 plugin that adds **sibling sessions** and
**session-to-session messaging** inside a single OpenCode runtime. This document
describes how the pieces fit together and why a few non-obvious choices were
made. The verified API shapes behind these choices are recorded in
[`API-REFERENCE.md`](./API-REFERENCE.md).

## Entry point and plugin shape

`index.ts` default-exports a plain object:

```ts
export default {
  id: "session-bus",
  async setup(ctx: Ctx) {
    await registerTools(ctx);
  },
};
```

There is **no runtime import** of `@opencode/plugin`: its `define` helper is the
identity function, so a plain `{ id, setup }` object is equivalent and the
plugin loads with zero module-resolution requirements. The context is consumed
structurally through the loose types in `src/types.ts` rather than by importing
the SDK's types.

Discovery: the runtime loads immediate package directories from
`~/.config/opencode/plugins/` (and a project's `.opencode/plugins/`). The
directory itself is the package, and `index.ts` is the entrypoint. No
`opencode.json` entry is required for a directory-installed plugin.

## Modules

### `src/types.ts`

Local, intentionally loose structural types describing only the subset of the V2
plugin context that is used, plus shared constants:

- `HOP_LIMIT = 4`, `BUS_NAMESPACE = "session_bus"`, `REGISTRY_PREFIX = "registry/"`.
- `SessionRef`, `RunResult`, `ToolInfo`, `Ctx`, and tool result shapes.

Keeping these local avoids a dependency on the young V2 type packages.

### `src/sessions.ts` — session lifecycle

Owns create/prompt/wait/reply extraction:

- `createSibling(ctx, { agent?, title? })` — calls `ctx.session.create`
  **without a `parentID`** (the create input has no parent field), so the
  result is a normal top-level session, i.e. a sibling rather than a child
  subagent.
- `sendPrompt(ctx, sessionID, text, mode = "steer")` — delivers text via
  `ctx.session.prompt`.
- `waitForNewReply(ctx, sessionID, baseline, timeoutMs)` — polls
  `ctx.session.context`, filters to assistant messages whose ids are **not** in
  `baseline`, and returns the text of the latest complete one (or `undefined` on
  timeout). See "Why `waitForNewReply` exists" below.
- `sendAndWait(...)` — snapshots the existing message ids, sends, then waits for
  a *new* reply.
- `lastAssistantText(...)` — returns the text of the last assistant message.
- `waitIdle(...)` — prefers the purpose-built `ctx.session.wait`, falling back to
  polling `ctx.session.get` for an outcome/idle marker.
- `runSibling(...)` — a full create → send → wait round-trip that never throws;
  returns a `RunResult` with status `done` / `timeout` / `error`.
- `listSessions(...)` — best-effort live-session enumeration. `ctx.session` is a
  `Pick` that excludes `list`, so it probes optional extensions and degrades to
  `[]`.

### `src/bus.ts` — messaging and registry

- `formatMessage(self, text, via?)` — pure, deterministic. Produces
  `[from <self>] <text>` plus an optional `\n(via: a,b)` suffix. Isolated from
  I/O so it can be unit-tested without a live context.
- `sendToSession(ctx, opts)` — guards **self-send** and the **hop chain**
  (`via.length > HOP_LIMIT`), then delivers via `ctx.session.prompt`. Returns
  `{ ok: false, error }` instead of throwing.
- `registerSession` / `listRegistered` — persist session references under
  `registry/<id>` in `ctx.storage` and list them (hiding entries older than 24 h).
- `pingSession` — best-effort non-prompting `ctx.session.synthetic` notice.

### `src/tools.ts` — tool registration

`makeTools(ctx)` builds the five tools (`session_new`, `session_send`,
`session_list`, `session_read`, `session_wait`) **per registration**, closing
over that location's context. This makes the plugin safe when several locations
(project configs) load it at once. `registerTools` adds them via
`ctx.tool.transform(editor => editor.add(tool))` and keeps the returned
`Registration` alive for the plugin's lifetime.

Tool results return `content` + `metadata`. They must not set `output` unless the
tool declares an `output` schema, so none do.

## Why `waitForNewReply` exists

Naively, "wait until the target is done" would check the session's `outcome`
(the terminal marker recorded at `time.idle`). But `outcome` is **stale**: it
describes the *last completed run*, so a session that already finished a prior
turn still has a non-empty `outcome` the moment a new message is sent. Treating
that as "this turn is done" would return the previous reply (or `undefined`).

`waitForNewReply` fixes this by taking a **baseline** of the message ids that
already existed before sending, then waiting for a *fresh* assistant message
that is not in the baseline and looks complete (`finish` set and not
`"tool-calls"`, or a `time.completed` stamp). This is what makes both
`session_send { wait: true }` and `session_new` return the correct new reply.

## Message flow

1. A caller invokes `session_new` or `session_send`.
2. `sessions.ts` creates/prompts; `bus.ts` formats and guards delivery.
3. On completion, a new assistant message appears in the target's context.
4. `waitForNewReply` (or the background completion notice in the `wait: false`
   branch of `session_new`) reads that fresh reply and returns it.

## Verified API facts (OpenCode v2.0.18)

- `ctx.session.create(...)` takes `{ id?, title?, agent?, model?, location?,
  metadata?, permissions? }` — no `parentID`; the returned `SessionInfo` *does*
  carry `parentID`.
- `ctx.session.prompt` takes `{ sessionID, text, delivery?: "steer" | "queue", ... }`.
- `ctx.session.synthetic` takes `{ sessionID, text, description?, ... }`.
- `ctx.session.wait` takes exactly `{ sessionID }` and resolves on the next idle.
- `ctx.session.context` returns a union of message kinds; an assistant message
  carries `content: Array<{ type: "text" | "reasoning" | "tool", ... }>`.
- `ctx.session.get` returns `SessionInfo`, which has no status field; idle/busy is
  inferred from `outcome` / `time.idle`, or authoritatively from
  `session.status` / `session.idle` events.
- `ctx.tool.transform(cb) → Promise<Registration>`; the editor callback is
  synchronous and must be awaited at the call site.
- `ctx.storage` exposes `get/set/remove/scan`.
- Config key for plugins is `plugins`; global plugin dir is
  `~/.config/opencode/plugins/`.

Full quotes and source references are in
[`API-REFERENCE.md`](./API-REFERENCE.md).
