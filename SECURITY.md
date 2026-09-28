# Security

`session-bus` lets one OpenCode session send text to another session in the same
runtime. That text is delivered as a **user turn**, so it is treated by the
target exactly like something a human typed: the target agent may decide to run
tools, edit files, or take other actions in response.

## Messages are untrusted input

Because a delivered message becomes a user turn, **peer and sibling content must
be treated as untrusted input**. A session that receives a message from another
session should not assume the message is safe, authorized, or truthful just
because it came from inside the runtime. In particular:

- Do not let peer messages silently expand a session's authority or scope.
- Do not treat a message from another session as an authenticated instruction
  from the user.
- Prefer running unattended, message-driven workflows in a sandbox or with a
  constrained tool/permission setup.

This is the same class of risk as prompt injection: the sender is another
language model, and its text can influence tool use downstream.

## Loop protections

The bus is deliberately conservative about runaway messaging:

- **Self-send is refused.** A session cannot send a message to itself
  (`sendToSession` returns `{ ok: false, error: "refusing to send to self" }`).
- **Hop limit.** A message chain that has already passed through more than
  `HOP_LIMIT` (4) hops is refused, which bounds reply ping-pong.
- Outgoing text is prefixed with `[from <session>]` and carries an optional
  `(via: a,b,...)` chain so receivers can see provenance.

**These guards do not detect cycles over time.** The hop limit caps the depth of
a single forwarded chain, but it cannot stop two or more sessions from
repeatedly messaging each other in separate turns indefinitely. If you build a
multi-session workflow, enforce your own time/cost budget and stop conditions.

## No permission gating

The plugin does **not** gate who may message whom, what may be said, or whether
a message is allowed to trigger tools. There is no allow-list, no content
filtering, and no approval step. Any session that can call `session_send` can
reach any other session it knows the id of.

Before running `session-bus` unattended (for example in a long-lived or
production runtime), review:

1. what tools the participating agents can call,
2. what the runtime's permission mode allows, and
3. whether outbound network/filesystem access is acceptable for model-generated
   messages.

If the answer is unclear, do not run it unattended.
