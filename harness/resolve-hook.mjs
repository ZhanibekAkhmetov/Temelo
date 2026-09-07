/**
 * Module resolution for the harness.
 *
 * Two mappings, and nothing else:
 *
 *  - `@/x` is the app's own path alias, declared in `tsconfig.json`. Metro
 *    understands it; Node does not, so it is resolved here against `src/`.
 *  - `expo-sqlite` is a native module that cannot exist outside a device
 *    build. It is redirected to `sqlite-stub.mjs`, which presents the same
 *    surface over Node's own SQLite. That is what lets the harness exercise
 *    the real `openTemeloDatabase`, the real migrations and the real
 *    repository rather than a re-implementation of them.
 *
 * TypeScript itself needs no handling: Node strips the types.
 */

import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = pathToFileURL(join(HERE, "..", "src") + "/").href;
const SQLITE_STUB = pathToFileURL(join(HERE, "sqlite-stub.mjs")).href;

const EXTENSIONS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

export async function resolve(specifier, context, next) {
  if (specifier === "expo-sqlite") return { url: SQLITE_STUB, shortCircuit: true };

  if (specifier.startsWith("@/")) {
    const base = SRC + specifier.slice(2);
    for (const extension of EXTENSIONS) {
      const candidate = base + extension;
      if (existsSync(new URL(candidate))) return { url: candidate, shortCircuit: true };
    }
  }

  return next(specifier, context);
}
