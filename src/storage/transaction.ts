/**
 * Who owns a transaction on the shared connection.
 *
 * `expo-sqlite`'s `withTransactionAsync` is documented as *not* exclusive, and
 * it is written accordingly: it issues a bare `BEGIN`, awaits the task, and
 * issues `COMMIT`, with a `ROLLBACK` in the catch. It holds no lock, keeps no
 * depth count, and has no idea whether another caller is already inside a
 * transaction on the same connection.
 *
 * Temelo has two independent writers on one handle — the timetable save queue
 * in `AppStateProvider`, and the reminder ledger, which is driven by the very
 * state changes that queue is persisting. An academic-day change soft-deletes
 * every placement, so it cancels every reminder: the ledger writes at exactly
 * the moment the timetable's transaction is open. What follows is not subtle:
 *
 *   1. the save issues `BEGIN` and starts its statements;
 *   2. the ledger issues `BEGIN`, which fails — "cannot start a transaction
 *      within a transaction";
 *   3. the ledger's own catch issues `ROLLBACK`, which succeeds and throws
 *      away *the save's* transaction along with every statement in it;
 *   4. the save's `COMMIT` finds nothing to commit and fails;
 *   5. the save's catch issues `ROLLBACK`, which fails with "cannot rollback -
 *      no transaction is active" — and because that rejection happens before
 *      the original error is rethrown, it is the only error anyone ever sees.
 *
 * So the message that reached the log named neither the writer that broke the
 * transaction nor the statement that failed. It named the cleanup.
 *
 * This module is the fix, and it is a fix at the source rather than a catch:
 *
 * - Every transaction on a given handle goes through one queue, so two of them
 *   can never overlap and a `BEGIN` can never nest. The queue is keyed on the
 *   database object, so it is per-connection, which is the scope SQLite's
 *   transaction state actually has.
 * - `ROLLBACK` is issued only when the connection really is still in a
 *   transaction, and a failure to roll back never replaces the error that
 *   caused it. The original cause is what propagates, always.
 *
 * Nothing above this module may call `db.withTransactionAsync` directly.
 */

import type { SQLiteDatabase } from "expo-sqlite";

/**
 * One queue per connection.
 *
 * A `WeakMap` rather than a field on the handle: the handle is
 * `expo-sqlite`'s, not ours, and a database that goes out of scope should take
 * its queue with it.
 */
const queues = new WeakMap<SQLiteDatabase, Promise<unknown>>();

function ignore(): void {}

/**
 * Runs `task` after everything already queued on this connection, and before
 * anything queued after it.
 *
 * The stored tail is deliberately a *swallowed* copy of the run: a task that
 * throws must not make every later task on the connection inherit its
 * rejection. The caller still receives the real outcome.
 */
export function runSerialized<T>(db: SQLiteDatabase, task: () => Promise<T>): Promise<T> {
  const tail = queues.get(db) ?? Promise.resolve();
  const run = tail.then(task);
  queues.set(db, run.then(ignore, ignore));
  return run;
}

/**
 * `BEGIN`, the task, `COMMIT` — serialized against every other transaction on
 * the same connection, so this is the only writer inside it.
 *
 * Reads may be done inside the task and are guaranteed to see a consistent
 * snapshot for the same reason: nothing else on this connection can be writing
 * while it runs.
 */
export function withTransaction<T>(db: SQLiteDatabase, task: () => Promise<T>): Promise<T> {
  return runSerialized(db, () => runTransaction(db, task));
}

async function runTransaction<T>(db: SQLiteDatabase, task: () => Promise<T>): Promise<T> {
  await db.execAsync("BEGIN");
  try {
    const result = await task();
    await db.execAsync("COMMIT");
    return result;
  } catch (error: unknown) {
    await rollback(db);
    throw error;
  }
}

/**
 * Undoes the transaction if there still is one.
 *
 * Two things make this different from the rollback that produced the reported
 * error. It asks whether a transaction is actually open — SQLite may have
 * ended it already, and `ROLLBACK` on a connection with no transaction is an
 * error in its own right. And it never throws: whatever went wrong inside the
 * transaction is what the caller needs to know about, and a failure to clean
 * up must not overwrite it.
 */
async function rollback(db: SQLiteDatabase): Promise<void> {
  try {
    if (typeof db.isInTransactionSync === "function" && !db.isInTransactionSync()) return;
  } catch {
    // The connection cannot say; attempting the rollback is the safer guess.
  }

  try {
    await db.execAsync("ROLLBACK");
  } catch (error: unknown) {
    console.warn("[temelo/storage] could not roll back a failed transaction", error);
  }
}
