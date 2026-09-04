/**
 * What Temelo has already done about each occurrence's reminder.
 *
 * The scheduler's reconciliation is otherwise stateless by design — the plan
 * is recomputed from the timetable every time, so nothing can drift. That
 * works for everything except one question, which no amount of recomputing
 * can answer: *has this occurrence already reminded?* Before this ledger the
 * answer lived in a `Set` in the scheduler's module scope, which is to say it
 * lived until the process died. A reminder that fired at 08:30 for a 09:00
 * class was forgotten the moment the app was killed, and reopening Temelo at
 * 08:45 found a reminder whose moment had passed and whose class had not
 * started — the "immediate" fallback — and showed it again.
 *
 * So this stores the minimum needed to not do that twice, and nothing more.
 * It is explicitly *not* a model of the OS: it does not mirror Android's
 * notification queue, does not track permission, and does not claim to know
 * whether the user saw anything. Those stay live reads against the platform.
 *
 * Every function here is failure-tolerant on purpose. A reminder ledger that
 * throws would take a timetable edit down with it, and the app is expected to
 * work — minus persistence — when SQLite is unavailable at all, so an
 * in-memory fallback shadows the table and keeps deduplication working for
 * the lifetime of the process even then.
 */

import type { SQLiteDatabase } from "expo-sqlite";

import { bootstrapStorage } from "@/storage/bootstrap";

/**
 * - `scheduled`: handed to the OS, which is now responsible for delivering
 *   it. Still revisable — a move before its moment cancels and replaces it.
 * - `handled`: Temelo itself presented it, or found it already in the tray.
 *   Terminal: an occurrence that reached this state never reminds again.
 */
export type ReminderDeliveryState = "scheduled" | "handled";

export interface ReminderLedgerEntry {
  /** `planReminders`' reminder key: placement, occurrence date, course. */
  key: string;
  /** The moment this row is about, epoch ms. */
  remindAt: number;
  /** When the class starts, epoch ms — what ageing rows out is judged on. */
  startAt: number;
  state: ReminderDeliveryState;
}

interface ReminderDeliveryRow {
  reminder_key: string;
  remind_at: number;
  start_at: number;
  state: string;
  updated_at: string;
}

/** How long a row outlives its class before being swept away. */
export const REMINDER_LEDGER_RETENTION_DAYS = 7;

const RETENTION_MS = REMINDER_LEDGER_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * Shadow copy, so deduplication still works for this process when the
 * database cannot be reached. Pruned alongside the table.
 */
const memory = new Map<string, ReminderLedgerEntry>();

async function database(): Promise<SQLiteDatabase | null> {
  try {
    return (await bootstrapStorage()).db;
  } catch {
    return null;
  }
}

function entryFromRow(row: ReminderDeliveryRow): ReminderLedgerEntry {
  return {
    key: row.reminder_key,
    remindAt: row.remind_at,
    startAt: row.start_at,
    // An unrecognised state is read as the terminal one. Being over-cautious
    // costs at most one missed reminder; the other way round is the bug.
    state: row.state === "scheduled" ? "scheduled" : "handled",
  };
}

/*
 * `handled` is terminal, so the conflict clause never lets a row fall back to
 * `scheduled`. Without that, a refresh happening between a reminder being
 * presented and the plan being recomputed could downgrade the very row that
 * records the delivery, and the occurrence would become eligible again.
 */
const UPSERT_DELIVERY = `
  INSERT INTO reminder_deliveries (reminder_key, remind_at, start_at, state, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (reminder_key) DO UPDATE SET
    remind_at  = CASE WHEN reminder_deliveries.state = 'handled'
                      THEN reminder_deliveries.remind_at ELSE excluded.remind_at END,
    start_at   = CASE WHEN reminder_deliveries.state = 'handled'
                      THEN reminder_deliveries.start_at  ELSE excluded.start_at  END,
    state      = CASE WHEN reminder_deliveries.state = 'handled'
                      THEN 'handled' ELSE excluded.state END,
    updated_at = excluded.updated_at
`;

/** Every entry the ledger holds, keyed by reminder key. */
export async function loadReminderLedger(): Promise<Map<string, ReminderLedgerEntry>> {
  const db = await database();
  if (!db) return new Map(memory);

  try {
    const rows = await db.getAllAsync<ReminderDeliveryRow>("SELECT * FROM reminder_deliveries");
    const entries = new Map(rows.map((row) => [row.reminder_key, entryFromRow(row)]));
    // Anything written while the database was unreachable still counts.
    for (const [key, entry] of memory) if (!entries.has(key)) entries.set(key, entry);
    return entries;
  } catch {
    return new Map(memory);
  }
}

/** Records what was scheduled or handled, in one transaction. */
export async function recordReminderDeliveries(entries: ReminderLedgerEntry[]): Promise<void> {
  if (entries.length === 0) return;

  for (const entry of entries) {
    const existing = memory.get(entry.key);
    // Mirror the SQL: the shadow copy must not downgrade a handled row either.
    if (existing?.state === "handled") continue;
    memory.set(entry.key, entry);
  }

  const db = await database();
  if (!db) return;

  const updatedAt = new Date().toISOString();
  try {
    await db.withTransactionAsync(async () => {
      for (const entry of entries) {
        await db.runAsync(UPSERT_DELIVERY, entry.key, entry.remindAt, entry.startAt, entry.state, updatedAt);
      }
    });
  } catch {
    // The shadow copy above still carries this session; the next refresh
    // writes again.
  }
}

/**
 * Drops rows for reminders that are no longer wanted at all — a class
 * deleted, or its reminder switched off — so re-enabling one starts clean.
 *
 * This is why the caller may only pass keys in the `scheduled` state. A
 * cancelled reminder's row would otherwise sit with a moment that quietly
 * slides into the past, and a `scheduled` row whose moment has passed is
 * read as delivered — which would suppress a reminder that never fired.
 */
export async function forgetReminderDeliveries(keys: string[]): Promise<void> {
  if (keys.length === 0) return;

  for (const key of keys) memory.delete(key);

  const db = await database();
  if (!db) return;

  try {
    await db.withTransactionAsync(async () => {
      for (const key of keys) {
        await db.runAsync("DELETE FROM reminder_deliveries WHERE reminder_key = ?", key);
      }
    });
  } catch {
    // Nothing to recover: the row is stale bookkeeping, not user data.
  }
}

/**
 * Ages out rows whose class started long enough ago that no reminder for it
 * could ever be produced again — `dispositionFor` calls anything past its
 * start "missed" — so the table stays proportional to the timetable rather
 * than to how long the app has been installed.
 */
export async function pruneReminderLedger(now: number): Promise<void> {
  const cutoff = now - RETENTION_MS;

  for (const [key, entry] of memory) if (entry.startAt < cutoff) memory.delete(key);

  const db = await database();
  if (!db) return;

  try {
    await db.runAsync("DELETE FROM reminder_deliveries WHERE start_at < ?", cutoff);
  } catch {
    // Growth is bounded by the next successful prune.
  }
}

/** Row count, for the development diagnostics panel only. */
export async function countReminderLedger(): Promise<number> {
  const db = await database();
  if (!db) return memory.size;
  try {
    const row = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) AS count FROM reminder_deliveries",
    );
    return row?.count ?? 0;
  } catch {
    return memory.size;
  }
}

/** Test seam: drops the in-process shadow copy. Does not touch the table. */
export function resetReminderLedgerCache(): void {
  memory.clear();
}
