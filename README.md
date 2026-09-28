# opencode-session-bus

An OpenCode V2 plugin that lets agents **spawn independent sibling sessions** and
**message each other** inside one OpenCode runtime.

Native subagents are children of the session that started them. This plugin adds
a different primitive: it creates **top-level ("sibling") sessions** with no
parent, so they appear as normal, equal sessions — and any session in the runtime
can send text to, read from, or wait on any other.

- Plugin id: `session-bus`
- Package name: `opencode-session-bus`
- Tested on OpenCode **v2.0.18**

## Sibling sessions vs subagents

| | Subagent (built-in) | Sibling (`session_new`) |
|---|---|---|
| Parent | Child of the starting session | None — a normal top-level session |
| Visibility | Owned by the parent | An equal, independent session |
| Messaging | Return value only | Any session can message any other |
| Lifetime | Usually scoped to the parent's task | Independent until stopped |

Use siblings when two or more workstreams should run in parallel as peers — for
example a coder and a reviewer, or several researchers reporting to a
coordinator.

## Install

`session-bus` is a plugin **directory**. Copy it into either plugins folder:

```
# global — loaded by every OpenCode V2 session on this machine
~/.config/opencode/plugins/session-bus/

# project-local — loaded only for this project
.opencode/plugins/session-bus/
```

OpenCode auto-discovers immediate package directories under those paths and
loads `index.ts` as the entrypoint. **No `opencode.json` entry is required.**

The plugin has **no runtime dependency** on `@opencode/plugin`; it default-exports
`{ id, setup }` and consumes the context structurally, so it loads with zero
module resolution.

If you prefer npm, install the package and reference it in `opencode.json`:

```jsonc
{ "plugins": ["opencode-session-bus"] }
```

## Tools

| Tool | Arguments | What it does |
|---|---|---|
| `session_new` | `task`, `agent?`, `title?`, `wait?`, `timeoutMs?` | Start a new top-level (sibling) session, send it the task. Blocks and returns its reply unless `wait: false`, in which case it returns the id immediately and the sibling messages you on completion. |
| `session_send` | `to`, `text`, `mode?` (`steer`\|`queue`), `wait?`, `timeoutMs?` | Send text to another session. `steer` (default) interrupts a running turn; `queue` waits for the next one. With `wait: true` it blocks for the target's reply. |
| `session_list` | — | List the sessions registered with the plugin, with best-effort busy/idle status. |
| `session_read` | `sessionID` | Return the last assistant reply from another session. |
| `session_wait` | `sessionID`, `timeoutMs?` | Block until the target becomes idle (bounded). |

## Examples

You can just say what you want in plain English — the agent picks the tool.

- **Delegate a task:** "Start a sibling session to audit the auth module and tell
  me what it finds."
- **Keep working in parallel:** "Spawn a researcher session to compare the two
  libraries, and keep editing the docs while it works."
- **Check on a peer:** "Ask session `ses_abc123` for a status update, and wait for
  its reply."
- **Coordinate a hand-off:** "Tell the session working on the tests that the API
  changed, then wait until it's idle."

## How a new session discovers it

Once the plugin is installed, its five tools are registered for the runtime, so
every session can call them. A freshly started sibling does not see a shared
roster by default — `session_list` can only show sessions the plugin has
registered (see Limitations). To let a sibling message a specific peer, include
that peer's session id in the task you give it, or have it call `session_list`.

## Limitations

- **Single runtime only.** Messaging works within one OpenCode runtime; there is
  no cross-process or cross-machine transport.
- **`session_list` cannot enumerate the runtime.** It can only show sessions the
  plugin has registered. Pass session ids directly to `session_send` /
  `session_read` when in doubt.
- **Requires OpenCode V2.** The V2 plugin/session API is young and may change.
- **No permission gating.** Any session that can call `session_send` can message
  any other session it knows the id of.

## Security

A delivered message becomes a **user turn** in the target session, so it can
cause tool use. Treat peer and sibling messages as **untrusted input**. The bus
refuses self-sends and caps forwarded chains at 4 hops, but it has **no cycle
detection over time** and **no permission gating**. Read
[`SECURITY.md`](./SECURITY.md) before running message-driven workflows
unattended.

## Docs & development

- [`docs/DESIGN.md`](./docs/DESIGN.md) — architecture and design decisions.
- [`docs/API-REFERENCE.md`](./docs/API-REFERENCE.md) — verified V2.0.18 API shapes.

```sh
bun test          # unit tests against an in-memory Ctx
bun run typecheck # tsc --noEmit
```

## License

MIT — see [`LICENSE`](./LICENSE).
