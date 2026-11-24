/**
 * Loaded by Node's test runner before any test file (`--import`, see the
 * `test` scripts in package.json).
 *
 * Two things the app's own bundler normally provides:
 *
 *  - the resolve hook: the `@/` path alias, and `expo-sqlite` redirected to
 *    Node's built-in SQLite (`sqlite-stub.mjs`). Node strips the TypeScript in
 *    `src/` itself, so nothing is compiled and no dependency is installed;
 *  - `__DEV__`, which Metro compiles in. Tests take the release branch.
 */

import { register } from "node:module";

register("./resolve-hook.mjs", import.meta.url);

globalThis.__DEV__ = false;
