// types/bun-test.d.ts — minimal ambient declaration for Bun's test runner.
//
// The project is verified with `tsc --noEmit` but does not depend on
// `@types/bun`, so this shim lets `import { test, expect } from "bun:test"`
// typecheck without installing the full Bun type package. It declares only the
// surface the tests use; anything else is intentionally loose (`any`).
declare module "bun:test" {
  export const test: any;
  export const expect: any;
}
