/**
 * `expo-sqlite`, as far as Temelo uses it, backed by Node's own SQLite.
 *
 * The point of this file is that the harness runs the *real* storage code —
 * `openTemeloDatabase`, `migrateToLatest`, `repairSchema`, `saveTimetable`,
 * `loadTimetable` — rather than a paraphrase of it. So the surface below is
 * shaped by what those modules actually call, and `withTransactionAsync` is
 * reproduced exactly as `expo-sqlite` implements it, including the behaviour
 * that caused the failure this harness exists to pin down:
 *
 *   try { BEGIN; await task(); COMMIT } catch (e) { await ROLLBACK; throw e }
 *
 * Two properties of that matter and are faithfully preserved. It holds no
 * lock, so two overlapping calls nest their `BEGIN`s; and its `ROLLBACK` is
 * awaited *before* the original error is rethrown, so when the rollback itself
 * fails — "cannot rollback - no transaction is active" — that is the error the
 * caller sees, and the real one is lost.
 *
 * Everything in Temelo now goes through `storage/transaction` instead, which
 * is what the harness checks. `withTransactionAsync` is kept here so the old
 * behaviour can still be demonstrated on demand.
 */

import { DatabaseSync } from "node:sqlite";

/** Only what SQLite can bind. Booleans are the one thing the app might pass. */
function bindable(value) {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === undefined) return null;
  return value;
}

function flatten(params) {
  // expo-sqlite accepts both `run(sql, a, b)` and `run(sql, [a, b])`.
  if (params.length === 1 && Array.isArray(params[0])) return params[0];
  return params;
}

class NodeSQLiteDatabase {
  constructor(path) {
    this.native = new DatabaseSync(path);
    /** Set by the harness to make one statement fail on purpose. */
    this.failPattern = null;
  }

  #guard(sql) {
    if (this.failPattern && sql.includes(this.failPattern)) {
      this.failPattern = null;
      throw new Error(`[harness] injected failure on: ${sql.trim().slice(0, 60)}`);
    }
  }

  async execAsync(source) {
    this.#guard(source);
    this.native.exec(source);
  }

  async runAsync(sql, ...params) {
    this.#guard(sql);
    return this.native.prepare(sql).run(...flatten(params).map(bindable));
  }

  async getAllAsync(sql, ...params) {
    this.#guard(sql);
    return this.native.prepare(sql).all(...flatten(params).map(bindable));
  }

  async getFirstAsync(sql, ...params) {
    this.#guard(sql);
    const row = this.native.prepare(sql).get(...flatten(params).map(bindable));
    return row ?? null;
  }

  isInTransactionSync() {
    return this.native.isTransaction;
  }

  /** `expo-sqlite`'s implementation, reproduced verbatim. Nothing calls it. */
  async withTransactionAsync(task) {
    try {
      await this.execAsync("BEGIN");
      await task();
      await this.execAsync("COMMIT");
    } catch (error) {
      await this.execAsync("ROLLBACK");
      throw error;
    }
  }

  closeSync() {
    this.native.close();
  }
}

/**
 * Where the next `openDatabaseAsync` should actually open.
 *
 * `openTemeloDatabase` names one file and one file only — it is the module
 * that owns the database's identity, and giving it a path parameter purely so
 * a harness could point it somewhere else would put test scaffolding into
 * production code. So the redirection lives here instead, where all the other
 * harness-only substitutions already are.
 */
let nextPath = ":memory:";

export function useDatabaseFile(path) {
  nextPath = path;
}

export async function openDatabaseAsync() {
  return new NodeSQLiteDatabase(nextPath);
}
