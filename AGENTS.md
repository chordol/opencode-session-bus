# session-bus — agent notes

## Where this plugin actually runs (read this first)

OpenCode loads the plugin from an **install clone**, not directly from this repo:

- `~/.config/opencode/plugins/session-bus` → `~/.local/share/opencode-plugins/session-bus` (symlink)
- that clone's git `origin` is **this repo** (`/Volumes/T9/Projects/General/opencode-session-bus`)

The loaded path is visible in the OpenCode log:

```
loading plugin id=~/.config/opencode/plugins/session-bus
  entrypoint=file:///Users/sasha/.local/share/opencode-plugins/session-bus/index.ts
```

## Promote a change (edit here, then pull)

1. Edit and commit in **this** repo (the T9 working copy).
2. Bring it into the loaded clone, which triggers one plugin reload:

```
git -C /Users/sasha/.local/share/opencode-plugins/session-bus pull
```

Run that when **no work is in flight** — it reloads the plugin.

## Verify it loaded

```
grep -iE "loading plugin.*session-bus|failed to load plugin" ~/.local/share/opencode/log/opencode.log | tail
```

If you see `failed to load plugin ... session-bus`, its tools (`session_new`,
`session_send`, `session_list`, `session_read`, `session_wait`, `session_delete`,
`session_move`, `session_model`) are **missing** from every session.

## If a pull does not take (stale module cache)

The OpenCode loader caches transpiled modules **per file**. After a breaking
change it can keep a stale revision and fail to load, e.g.
`SyntaxError: Export named 'X' not found` even though the source is correct.
A `reload` may not clear it. Restart the service:

```
launchctl kickstart -k gui/$(id -u)/com.sasha.opencode-service
```

To avoid this: prefer **adding** exports over removing them, and keep a no-op
compatibility export when you delete one.

## Tests

`bun test` and `npx --yes tsc --noEmit` must pass before you promote.
