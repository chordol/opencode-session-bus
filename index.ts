// session-bus — OpenCode V2 plugin.
//
// Provides sibling (top-level) sessions and session-to-session messaging for a
// single OpenCode runtime. Exported as a plain object: `@opencode/plugin`'s
// `define` is the identity function, so no runtime dependency is required.
//
// Discovery: this directory lives at ~/.config/opencode/plugins/session-bus/ and
// is loaded as an immediate plugin package (entrypoint: index.ts).
import { registerTools } from "./src/tools.js";
import type { Ctx } from "./src/types.js";

export default {
  id: "session-bus",
  async setup(ctx: Ctx): Promise<void> {
    await registerTools(ctx);
    // eslint-disable-next-line no-console
    console.log("[session-bus] ready: session_new, session_send, session_list, session_read, session_wait");
  },
};
