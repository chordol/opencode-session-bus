# Changelog

## 0.1.0 — 2026-09-28

Initial release. Tested on OpenCode v2.0.18.

- **Sibling sessions** — `session_new` creates a top-level session with no
  `parentID` (a peer, not a child subagent). Blocking or background mode.
- **Session-to-session messaging** — `session_send` delivers text to any session
  (`steer` / `queue`), optionally blocking for the target's next reply.
- **Inspection** — `session_read` (last assistant reply), `session_wait` (block
  until idle), `session_list` (plugin-registered sessions with status).
- **Loop guards** — refuses self-sends; caps forwarded chains at 4 hops.
- **Correct completion detection** — `waitForNewReply` waits for a *new* completed
  assistant message, avoiding the stale-`outcome` false positive found in testing.
- Unit tests (`bun test`, against an in-memory `Ctx`), GitHub Actions CI,
  MIT license, `SECURITY.md`, and design/API docs.
