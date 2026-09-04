/**
 * Keeping the OS's idea of the next fortnight in step with the timetable's.
 *
 * The plan is computed fresh every time (`domain/reminderSchedule`) and then
 * reconciled against what is actually scheduled, rather than being tracked
 * incrementally. That is the whole design: there is no bookkeeping to get out
 * of step with a move, a split series, a deleted class or a changed term, and
 * a refresh after any of them converges on the same answer as a refresh after
 * all of them.
 *
 * Duplicate delivery is prevented at three levels:
 *
 *  - every notification carries an identifier derived from its reminder key,
 *    so scheduling the same occurrence twice replaces rather than duplicates;
 *  - a scheduled notification whose content and moment still match the plan
 *    is left alone, so a refresh does not cancel and re-post reminders the
 *    user can already see queued;
 *  - a reminder that is presented immediately is remembered by key *and*
 *    moment, and reminders already in the tray are read back at every
 *    refresh, so a reminder the OS delivered while the app was closed is not
 *    shown a second time when the app reopens.
 *
 * Nothing here is allowed to fail loudly. Saving a class must work whether or
 * not its reminder can ever be delivered.
 */

import { planReminders, immediateReminders, schedulableReminders, type PlannedReminder } from "@/domain/reminderSchedule";
import type { Course, OccurrenceException, Placement, TimeSlot } from "@/types/models";
import {
  cancelReminderAsync,
  ensureReminderChannelAsync,
  getNotificationsDiagnostics,
  getPresentedRemindersAsync,
  getReminderPermissionAsync,
  getScheduledRemindersAsync,
  identifierFor,
  presentReminderNowAsync,
  REMINDER_CHANNEL_ID,
  requestReminderPermissionAsync,
  scheduleReminderAsync,
  type ReminderPermission,
  type ScheduledReminder,
} from "@/util/notifications";

export interface ReminderSyncInput {
  placements: Placement[];
  courses: Course[];
  exceptions: OccurrenceException[];
  timeSlots: TimeSlot[];
  /** First day of the rolling window — today, as the app reads it. */
  fromDate: string;
}

export interface ReminderStatus {
  permission: ReminderPermission;
  /**
   * Reminders the window contains whose moment is still ahead — before the
   * trim to what the OS will hold, so the two can be compared.
   */
  plannedCount: number;
  /** Reminders actually handed to the OS after the last refresh. */
  scheduledCount: number;
  /** What the last refresh did. */
  lastScheduled: number;
  lastCancelled: number;
  lastPresented: number;
  lastRunAt: number | null;
  lastError: string | null;
}

const INITIAL_STATUS: ReminderStatus = {
  permission: "undetermined",
  plannedCount: 0,
  scheduledCount: 0,
  lastScheduled: 0,
  lastCancelled: 0,
  lastPresented: 0,
  lastRunAt: null,
  lastError: null,
};

let status: ReminderStatus = INITIAL_STATUS;
const listeners = new Set<() => void>();

function publish(next: Partial<ReminderStatus>): void {
  status = { ...status, ...next, lastError: getNotificationsDiagnostics().lastError };
  for (const listener of listeners) listener();
}

export function getReminderStatus(): ReminderStatus {
  return status;
}

export function subscribeToReminderStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Reminders whose moment has already been dealt with, as `key@moment`.
 *
 * The moment is part of the identity on purpose: changing a class's reminder
 * from 30 to 60 minutes produces a genuinely different reminder, and if the
 * new one is already due it deserves to be shown even though the old one was
 * handled.
 */
const handled = new Set<string>();

function handledKey(key: string, remindAt: number): string {
  return `${key}@${remindAt}`;
}

function markHandled(reminder: PlannedReminder): void {
  handled.add(handledKey(reminder.key, reminder.remindAt));
}

/**
 * Whether an already-scheduled notification is still the one the plan wants.
 *
 * The fingerprint covers its moment and its words. The channel is the other
 * half: a notification queued against a superseded channel would deliver
 * with that channel's behaviour — the point of versioning the channel is
 * lost if a fortnight of already-scheduled reminders keeps using the old
 * one. A mismatch here makes it obsolete, so it is cancelled and replaced
 * like any other stale reminder, through exactly the same path.
 *
 * This deliberately says nothing about reminders that have already been
 * delivered: those are not scheduled any more, and whether one has been
 * handled is the `handled` set's question, not this one.
 */
function stillCorrect(wanted: PlannedReminder, scheduled: ScheduledReminder): boolean {
  return wanted.fingerprint === scheduled.fingerprint && scheduled.channelId === REMINDER_CHANNEL_ID;
}

/**
 * Permission is asked for at most once per launch, and only when there is a
 * reminder that would otherwise go undelivered — never on a cold start with
 * an empty timetable, and never again once the user has answered.
 */
let permissionAsked = false;

async function resolvePermission(hasWork: boolean): Promise<ReminderPermission> {
  const current = await getReminderPermissionAsync();
  if (current !== "undetermined" || !hasWork || permissionAsked) return current;
  permissionAsked = true;
  return requestReminderPermissionAsync();
}

/**
 * Cancels every reminder we have scheduled. Used when permission is not (or
 * no longer) granted, so revoking it does not leave a queue of notifications
 * the user never agreed to.
 */
async function cancelAllOursAsync(): Promise<number> {
  const existing = await getScheduledRemindersAsync();
  for (const scheduled of existing) await cancelReminderAsync(scheduled.identifier);
  return existing.length;
}

async function runSync(input: ReminderSyncInput): Promise<void> {
  const now = Date.now();
  const plan = planReminders({ ...input, now });
  const wanted = schedulableReminders(plan);
  const due = immediateReminders(plan);
  const upcoming = plan.filter((reminder) => reminder.disposition === "schedule").length;

  const permission = await resolvePermission(wanted.length > 0 || due.length > 0);
  if (permission !== "granted") {
    const cancelled = await cancelAllOursAsync();
    publish({
      permission,
      plannedCount: upcoming,
      scheduledCount: 0,
      lastScheduled: 0,
      lastCancelled: cancelled,
      lastPresented: 0,
      lastRunAt: now,
    });
    return;
  }

  await ensureReminderChannelAsync();

  // Anything already in the tray counts as handled, whoever delivered it.
  for (const mark of await getPresentedRemindersAsync()) handled.add(handledKey(mark.key, mark.remindAt));

  const wantedByIdentifier = new Map(wanted.map((reminder) => [identifierFor(reminder.key), reminder]));
  const alreadyCorrect = new Set<string>();
  let cancelled = 0;

  // Obsolete first, so a slot freed by a moved class is never briefly held
  // by both the old notification and the new one.
  for (const scheduled of await getScheduledRemindersAsync()) {
    const want = wantedByIdentifier.get(scheduled.identifier);
    if (want && stillCorrect(want, scheduled)) {
      alreadyCorrect.add(scheduled.identifier);
      markHandled(want);
      continue;
    }
    await cancelReminderAsync(scheduled.identifier);
    cancelled += 1;
  }

  let scheduledNow = 0;
  for (const reminder of wanted) {
    if (alreadyCorrect.has(identifierFor(reminder.key))) continue;
    if (!(await scheduleReminderAsync(reminder))) continue;
    scheduledNow += 1;
    // Once the OS has it, its delivery is no longer our business — and it
    // must not also be presented immediately by a later refresh.
    markHandled(reminder);
  }

  let presentedNow = 0;
  for (const reminder of due) {
    if (handled.has(handledKey(reminder.key, reminder.remindAt))) continue;
    if (!(await presentReminderNowAsync(reminder))) continue;
    presentedNow += 1;
    markHandled(reminder);
  }

  publish({
    permission,
    plannedCount: upcoming,
    scheduledCount: alreadyCorrect.size + scheduledNow,
    lastScheduled: scheduledNow,
    lastCancelled: cancelled,
    lastPresented: presentedNow,
    lastRunAt: now,
  });
}

/*
 * Refreshes are serialised. Two of them interleaving would read the same
 * "already scheduled" list and both act on it, which is the one way this
 * design could produce a duplicate. A refresh requested while another is
 * running is collapsed into a single follow-up run with the newest input,
 * because intermediate states of a drag or a burst of edits are not worth
 * a round trip to the OS each.
 */
let running: Promise<void> | null = null;
let pendingInput: ReminderSyncInput | null = null;
let lastInput: ReminderSyncInput | null = null;

async function drain(): Promise<void> {
  while (pendingInput) {
    const input = pendingInput;
    pendingInput = null;
    try {
      await runSync(input);
    } catch {
      // runSync's own calls never throw; this is the last line of defence,
      // and a failed refresh must not take the app with it.
      publish({ lastRunAt: Date.now() });
    }
  }
  running = null;
}

/** Brings the OS's scheduled reminders in line with the timetable. */
export function syncClassReminders(input: ReminderSyncInput): void {
  lastInput = input;
  pendingInput = input;
  if (running) return;
  running = drain();
}

/** Repeats the last refresh — for the development diagnostics panel. */
export function resyncClassReminders(): void {
  if (lastInput) syncClassReminders(lastInput);
}
