/**
 * Entry point for the harness.
 *
 * Registers the resolve hook — the app's `@/` alias, and `expo-sqlite`
 * redirected to Node's own SQLite — and then runs the suites. Node strips the
 * TypeScript itself, so nothing is compiled and nothing is installed.
 *
 *   node harness/run.mjs
 *
 * Exits non-zero if anything failed.
 */

import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

register("./resolve-hook.mjs", import.meta.url);

// The app compiles `__DEV__` in through Metro; anything the harness reaches
// that consults it should take the release branch.
globalThis.__DEV__ = false;

const here = dirname(fileURLToPath(import.meta.url));
const load = (file) => import(pathToFileURL(join(here, file)).href);

const { summarize } = await load("report.mjs");
const { runGeometryHarness } = await load("geometry.mjs");
const { runStorageHarness } = await load("storage.mjs");
const { runLifecycleHarness } = await load("lifecycle.mjs");
const { runTransferHarness } = await load("transfer.mjs");
const { runNavigationHarness } = await load("navigation.mjs");
const { runArchitectureHarness } = await load("architecture.mjs");

runGeometryHarness();
runNavigationHarness();
runArchitectureHarness();
await runStorageHarness();
await runLifecycleHarness();
await runTransferHarness();

summarize();
