/**
 * Which reminders the next fortnight actually contains.
 *
 * This is the one place a lead time becomes a moment. Everything else in the
 * domain deals in local dates and HH:mm on purpose; a notification, though,
 * has to be handed to the OS as an instant, so the conversion is done here,
 * once, from the local calendar parts — never through `Date.parse` — and
 * nothing downstream has to think about time zones again.
 *
 * The result is a plan, not an action: a list of concrete occurrences with
 * the moment each reminder belongs at, and which of the three things should
 * happen to it. `features/reminders/scheduler` is what carries it out.
 *
 * Repeating OS notifications are deliberately not used. A weekly trigger
 * cannot express an every-two-week class, a series that was split, or an
 * occurrence that was moved — and those are exactly the cases the timetable
 * is built around. One notification per resolved occurrence can express all
 * of them, because the occurrences have already been resolved.
 */

import { addDaysIso } from "@/domain/date";
import { resolveOccurrences, type OccurrenceSource } from "@/domain/occurrence";
import { formatLeadTime } from "@/domain/reminder";
import { parseHHmmToMinutes } from "@/domain/time";
import type { TimeSlot } from "@/types/models";

/** How far ahead reminders are kept scheduled, rolling forward with today. */
export const REMINDER_WINDOW_DAYS = 14;

/**
 * Upper bound on how many reminders are handed to the OS at once.
 *
 * iOS keeps at most 64 pending local notifications per app and silently
 * drops the rest, so the window is trimmed to the soonest reminders rather
 * than letting the platform decide which ones to lose. Each refresh moves
 * the trim line forward, so later occurrences are picked up as earlier ones
 * are delivered.
 */
export const MAX_SCHEDULED_REMINDERS = 60;

/** What should happen to one occurrence's reminder at this moment. */
export type ReminderDisposition =
  /** Its moment is still ahead: hand it to the OS. */
  | "schedule"
  /** Its moment has passed but the class has not started: show it now. */
  | "immediate"
  /** The class has already started; a late reminder would be noise. */
  | "missed";

export interface PlannedReminder {
  /**
   * Stable identity of the reminder, carried in the notification's data so a
   * later refresh can tell what is already scheduled from what is not.
   * Placement, occurrence date and course, as the three things that decide
   * whether this is still the same reminder at all.
   */
  key: string;
  placementId: string;
  /** The date this occurrence has in its base series. */
  occurrenceDate: string;
  /** The date it actually happens on, which a move can change. */
  date: string;
  courseId: string;
  reminderMinutes: number;
  /** Local start of the class, as an epoch milliseconds instant. */
  startAt: number;
  /** When the reminder is due, as an epoch milliseconds instant. */
  remindAt: number;
  title: string;
  body: string;
  disposition: ReminderDisposition;
  /**
   * Everything that decides whether an already-scheduled notification is
   * still the right one. A change to the time or to the words it will show
   * makes it stale, and a stale notification is cancelled and replaced.
   */
  fingerprint: string;
}

export interface ReminderPlanInput extends OccurrenceSource {
  timeSlots: TimeSlot[];
  /** First day of the rolling window — today, in local terms. */
  fromDate: string;
  /** The moment the plan is made, as epoch milliseconds. */
  now: number;
}

/**
 * The instant a local date and an HH:mm time name, built from the calendar
 * parts so it lands on the wall clock the user reads rather than on a
 * UTC-shifted one.
 */
function localInstant(isoDate: string, hhmm: string): number {
  const [year, month, day] = isoDate.split("-").map(Number);
  const minutes = parseHHmmToMinutes(hhmm);
  if (minutes === null || !Number.isFinite(year)) return Number.NaN;
  return new Date(year, month - 1, day, Math.floor(minutes / 60), minutes % 60, 0, 0).getTime();
}

/**
 * What the notification says. Compact on purpose — a reminder is read at a
 * glance on a lock screen, so it leads with how long is left, and drops the
 * room entirely rather than showing an empty separator when there isn't one.
 */
export function reminderBody(reminderMinutes: number, room: string, startTime: string): string {
  const parts = [`Starts in ${formatLeadTime(reminderMinutes)}`];
  const trimmedRoom = room.trim();
  if (trimmedRoom) parts.push(`Room ${trimmedRoom}`);
  parts.push(startTime);
  return parts.join(" · ");
}

function dispositionFor(remindAt: number, startAt: number, now: number): ReminderDisposition {
  if (remindAt > now) return "schedule";
  return now < startAt ? "immediate" : "missed";
}

/** The dates the rolling window covers, starting at `fromDate`. */
export function reminderWindowDates(fromDate: string): string[] {
  return Array.from({ length: REMINDER_WINDOW_DAYS }, (_, index) => addDaysIso(fromDate, index));
}

/**
 * Every reminder the window contains, soonest first.
 *
 * Occurrences come from the same resolver the grid draws from, so a split
 * series, a moved occurrence, a cancelled one and an alternating class are
 * all already accounted for by the time this sees them — and two classes
 * sharing one slot on alternating weeks produce reminders on different
 * dates, never two for the same one.
 */
export function planReminders(input: ReminderPlanInput): PlannedReminder[] {
  const { timeSlots, fromDate, now } = input;
  const slotById = new Map(timeSlots.map((slot) => [slot.id, slot]));

  const planned = resolveOccurrences(input, reminderWindowDates(fromDate)).flatMap<PlannedReminder>((occurrence) => {
    // A preview is an edit the user has not committed yet; it must not
    // reach the OS.
    if (occurrence.pending) return [];

    const reminderMinutes = occurrence.placement.reminderMinutes;
    if (reminderMinutes === null || !Number.isFinite(reminderMinutes) || reminderMinutes < 0) return [];

    const slot = slotById.get(occurrence.placement.timeSlotId);
    if (!slot) return [];

    const startAt = localInstant(occurrence.date, slot.startTime);
    if (!Number.isFinite(startAt)) return [];

    const remindAt = startAt - reminderMinutes * 60_000;
    const title = occurrence.course.name;
    const body = reminderBody(reminderMinutes, occurrence.course.room, slot.startTime);

    return [
      {
        key: `${occurrence.basePlacement.id}|${occurrence.occurrenceDate}|${occurrence.course.id}`,
        placementId: occurrence.basePlacement.id,
        occurrenceDate: occurrence.occurrenceDate,
        date: occurrence.date,
        courseId: occurrence.course.id,
        reminderMinutes,
        startAt,
        remindAt,
        title,
        body,
        disposition: dispositionFor(remindAt, startAt, now),
        fingerprint: `${remindAt}|${title}|${body}`,
      },
    ];
  });

  planned.sort((a, b) => a.remindAt - b.remindAt);
  return planned;
}

/** The part of a plan that is handed to the OS, trimmed to what it will hold. */
export function schedulableReminders(planned: PlannedReminder[]): PlannedReminder[] {
  return planned.filter((reminder) => reminder.disposition === "schedule").slice(0, MAX_SCHEDULED_REMINDERS);
}

/** The part of a plan whose moment has passed while the class has not begun. */
export function immediateReminders(planned: PlannedReminder[]): PlannedReminder[] {
  return planned.filter((reminder) => reminder.disposition === "immediate");
}
