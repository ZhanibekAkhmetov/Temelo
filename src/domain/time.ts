/**
 * Local HH:mm time-of-day handling and academic-day time-slot generation.
 * Pure TypeScript — no React, no Date-based timestamps — because recurring
 * lesson times are a local weekday + HH:mm concept, not a UTC instant.
 */

const HHMM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const MINUTES_PER_DAY = 24 * 60;
export const MAX_SLOT_COUNT = 16;

export function isValidHHmm(value: string): boolean {
  return HHMM_PATTERN.test(value);
}

export function parseHHmmToMinutes(value: string): number | null {
  const match = HHMM_PATTERN.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Hour/minute pair for the wheel picker; null when `value` isn't HH:mm. */
export function splitHHmm(value: string): { hours: number; minutes: number } | null {
  const totalMinutes = parseHHmmToMinutes(value);
  if (totalMinutes === null) return null;
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

export function joinHHmm(hours: number, minutes: number): string {
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** A length of time as "1 h 30 min", "45 min" or "2 h". */
export function formatDurationMinutes(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return "0 min";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${minutes} min`;
}

function formatMinutesToHHmm(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export interface GenerateTimeSlotsInput {
  dayStart: string;
  lessonDurationMinutes: number;
  breakDurationMinutes: number;
  slotCount: number;
}

export interface GeneratedTimeSlot {
  position: number;
  startTime: string;
  endTime: string;
}

export type GenerateTimeSlotsResult =
  | { ok: true; slots: GeneratedTimeSlot[] }
  | { ok: false; error: string };

export function generateTimeSlots(
  input: GenerateTimeSlotsInput,
): GenerateTimeSlotsResult {
  const startMinutes = parseHHmmToMinutes(input.dayStart);
  if (startMinutes === null) {
    return { ok: false, error: "Academic day start must be a valid time (HH:mm)." };
  }
  if (!Number.isInteger(input.lessonDurationMinutes) || input.lessonDurationMinutes <= 0) {
    return { ok: false, error: "Lesson duration must be a positive number of minutes." };
  }
  if (!Number.isInteger(input.breakDurationMinutes) || input.breakDurationMinutes < 0) {
    return { ok: false, error: "Break duration must be zero or a positive number of minutes." };
  }
  if (!Number.isInteger(input.slotCount) || input.slotCount <= 0) {
    return { ok: false, error: "Number of periods must be a positive whole number." };
  }
  if (input.slotCount > MAX_SLOT_COUNT) {
    return { ok: false, error: `Number of periods must be ${MAX_SLOT_COUNT} or fewer.` };
  }

  const slots: GeneratedTimeSlot[] = [];
  let cursor = startMinutes;
  for (let i = 0; i < input.slotCount; i++) {
    const slotStart = cursor;
    const slotEnd = slotStart + input.lessonDurationMinutes;
    if (slotEnd >= MINUTES_PER_DAY) {
      return {
        ok: false,
        error: `Period ${i + 1} would end after midnight. Reduce the number of periods, lesson duration, or start time.`,
      };
    }
    slots.push({
      position: i + 1,
      startTime: formatMinutesToHHmm(slotStart),
      endTime: formatMinutesToHHmm(slotEnd),
    });
    cursor = slotEnd + input.breakDurationMinutes;
  }

  return { ok: true, slots };
}

/** Local wall-clock time as HH:mm — for locating "now" within a day's slots, not stored data. */
export function nowHHmm(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

/**
 * Index of the slot most relevant to the current moment: the slot in
 * progress, the next upcoming slot (before the day starts or during a
 * break), or the first slot again once the day's last lesson has ended.
 * `slots` must already be ordered by position (as generateTimeSlots
 * produces them). HH:mm strings compare correctly as plain strings.
 */
export function findCurrentPeriodIndex(
  slots: { startTime: string; endTime: string }[],
  nowTime: string,
): number {
  if (slots.length === 0) return 0;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (nowTime < slot.startTime) return i;
    if (nowTime < slot.endTime) return i;
  }
  return 0;
}

/**
 * Which period boundaries deserve a stronger line on the grid: the start of
 * the day, and any period that begins after a longer gap than the routine
 * one between lessons — a real break in the day rather than the change-over
 * that happens every period. Everything else is a minor line.
 */
export function findMajorBoundaries(slots: { startTime: string; endTime: string }[]): boolean[] {
  const gaps = slots.map((slot, index) => {
    if (index === 0) return -1;
    const start = parseHHmmToMinutes(slot.startTime);
    const previousEnd = parseHHmmToMinutes(slots[index - 1].endTime);
    return start === null || previousEnd === null ? -1 : start - previousEnd;
  });

  const routineGaps = gaps.filter((gap) => gap >= 0);
  const routineGap = routineGaps.length > 0 ? Math.min(...routineGaps) : 0;

  return slots.map((_, index) => index === 0 || gaps[index] > routineGap);
}

export interface PeriodProgress {
  index: number;
  /** How far through that period the current moment is, 0–1. */
  fraction: number;
}

/**
 * Where "now" sits inside the period currently in progress, for the
 * current-time marker. Returns null outside lesson time (before the day
 * starts, during a break, after the last period) — the marker is only
 * meaningful within a period, since the grid's rows are periods rather than
 * uniform clock hours.
 */
export function findPeriodProgress(
  slots: { startTime: string; endTime: string }[],
  nowTime: string,
): PeriodProgress | null {
  const nowMinutes = parseHHmmToMinutes(nowTime);
  if (nowMinutes === null) return null;

  for (let i = 0; i < slots.length; i++) {
    const start = parseHHmmToMinutes(slots[i].startTime);
    const end = parseHHmmToMinutes(slots[i].endTime);
    if (start === null || end === null || end <= start) continue;
    if (nowMinutes < start || nowMinutes >= end) continue;
    return { index: i, fraction: (nowMinutes - start) / (end - start) };
  }
  return null;
}
