/**
 * The `.ics` file: a timetable as events somebody else's calendar understands.
 *
 * The sibling of `storage/timetableFile`, and deliberately the opposite kind of
 * thing. A `.temelo` is Temelo's own format, round-trips, and is read back by
 * this same app; an `.ics` is a one-way handover to Google Calendar, Samsung
 * Calendar or Apple Calendar, and nothing in Temelo ever reads one. So this
 * module only writes, has no parser, and has no envelope or version of its own
 * — the format is RFC 5545, which is already versioned by `VERSION:2.0`.
 *
 * ## Why events and not recurrence rules
 *
 * Temelo's editing model is richer than `RRULE` — an occurrence can be moved to
 * another day and period, deleted on its own, or split off into a new series by
 * a "this and future" edit — and translating it into `RRULE`/`RDATE`/`EXDATE`
 * would mean a second implementation of recurrence whose bugs would only ever
 * show up inside somebody else's calendar app. Because the export is bounded to
 * a date range, it does not need one: `domain/calendarExport` resolves the
 * range through the *same* resolver the grid draws from, and every occurrence
 * arrives here as a plain dated event. A deleted occurrence is simply not in
 * the list, a moved one is in it once at the date it moved to, and a split
 * series is two ordinary runs of events. See the note there.
 *
 * ## Floating times, and why there is no TZID
 *
 * Temelo stores a recurring class as a local weekday and an `HH:mm`, and it
 * stores no timezone — not on the timetable, not in settings, nowhere (see
 * `types/models`). "Maths is at 09:00" is the whole of what it knows.
 *
 * So the events are written as RFC 5545 *floating* date-times: `DTSTART` and
 * `DTEND` with no `Z` and no `TZID`, which means "whatever local time the
 * reading device is in". That is exactly Temelo's own meaning, and it is the
 * only honest option: inventing a `TZID` from the exporting device would claim
 * the app knows the institution's IANA zone, and a class exported in Berlin
 * would then move by an hour when its timetable was read in Almaty. `DTSTAMP`
 * is a real instant — when the file was written — so it is correctly in UTC.
 *
 * The one consequence worth knowing: a user who exports in one country and
 * reads the file in another sees the classes at the same wall-clock time
 * rather than shifted. For a timetable that is the right answer.
 */

import type { CalendarOccurrence } from "@/domain/calendarExport";
import { sanitizeFileNameStem } from "@/storage/fileName";

export const CALENDAR_FILE_EXTENSION = ".ics";

/**
 * What the share sheet is told the file is.
 *
 * Unlike `.temelo`, this one has a registered type everywhere, and naming it
 * is what makes a calendar app appear in the share sheet at all.
 */
export const CALENDAR_FILE_MIME_TYPE = "text/calendar";

/**
 * The iOS uniform type identifier for an iCalendar file.
 *
 * A system-declared UTI that conforms to `public.text`, so iOS offers Calendar
 * and the file previews as text elsewhere. Android ignores it entirely — it
 * routes on the MIME type above — so naming it costs that platform nothing.
 */
export const CALENDAR_FILE_UTI = "com.apple.ical.ics";

/** Identifies the software that wrote the file, as RFC 5545 requires. */
export const ICS_PRODUCT_ID = "-//Temelo//Timetable//EN";

/** The domain half of every UID. Never resolved; it is an identifier, not a URL. */
const UID_DOMAIN = "temelo.app";

/** RFC 5545 3.1: content lines are delimited by CRLF, not by a bare newline. */
const CRLF = "\r\n";

/* ------------------------------------------------------------ text escaping */

/**
 * A value as RFC 5545 3.3.11 TEXT.
 *
 * Four escapes and no more: backslash, semicolon, comma and newline. The
 * backslash has to go first, or it would escape the backslashes the later
 * replacements introduce and every comma would arrive as a literal backslash
 * followed by a comma.
 *
 * A colon is deliberately *not* escaped. It is a delimiter in a content line's
 * header, not inside a TEXT value, and escaping it produces a sequence some
 * calendar clients show verbatim. "Room A:1" stays "Room A:1".
 *
 * Control characters are dropped rather than escaped: the grammar does not
 * admit them, a tab is the one exception it does, and a class name containing
 * a vertical tab is a paste accident rather than something to preserve.
 */
export function escapeIcsText(value: string): string {
  return [...value]
    .map((point) => {
      const code = point.codePointAt(0) ?? 0;
      if (code === 0x0a) return "\\n";
      // A lone CR, or the CR of a CRLF — either way the pair collapses to one
      // escaped newline, because the LF beside it produces the escape.
      if (code === 0x0d) return "";
      if (point === "\\") return "\\\\";
      if (point === ";") return "\\;";
      if (point === ",") return "\\,";
      if (code < 0x20 && code !== 0x09) return "";
      if (code === 0x7f) return "";
      return point;
    })
    .join("");
}

/* ---------------------------------------------------------------- folding */

/** RFC 5545 3.1: a content line is at most 75 octets, excluding the CRLF. */
const MAX_LINE_OCTETS = 75;

/** How many bytes a code point takes in UTF-8. */
function octetsOf(point: string): number {
  const code = point.codePointAt(0) ?? 0;
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code < 0x10000) return 3;
  return 4;
}

/**
 * One content line, folded to 75 octets per physical line.
 *
 * Octets, not JavaScript characters, and that distinction is the whole reason
 * this is not a `slice(0, 75)`. A `String.length` of 75 is up to 300 bytes of
 * Cyrillic or emoji, which overruns the limit several times over; and slicing
 * by UTF-16 unit can cut an emoji in half, leaving a lone surrogate that is not
 * valid UTF-8 at all and that some parsers reject outright. Iterating with
 * `for...of` walks whole code points, so a character is never split and the
 * budget is measured in the units the RFC actually specifies.
 *
 * A continuation line begins with one space, which counts toward its own 75
 * octets — so it carries 74 of content. The space is part of the fold and is
 * removed when the line is unfolded, not part of the value.
 */
export function foldIcsLine(line: string): string {
  const folded: string[] = [];
  let current = "";
  let used = 0;

  for (const point of line) {
    const size = octetsOf(point);
    if (used + size > MAX_LINE_OCTETS) {
      folded.push(current);
      current = " ";
      used = 1;
    }
    current += point;
    used += size;
  }

  folded.push(current);
  return folded.join(CRLF);
}

/* ------------------------------------------------------------- date & time */

/** `2026-09-14` + `09:00` becomes `20260914T090000`, with no zone: floating. */
export function icsFloatingDateTime(date: string, time: string): string {
  return `${date.replace(/-/g, "")}T${time.replace(":", "")}00`;
}

/**
 * An ISO instant as `DTSTAMP`'s UTC form: `20260914T071500Z`.
 *
 * This one really is an instant — the moment the file was written — so unlike
 * the events it is correctly in UTC, and the `Z` says so.
 */
export function icsUtcTimestamp(isoInstant: string): string {
  const stamped = new Date(isoInstant);
  const at = Number.isNaN(stamped.getTime()) ? new Date(0) : stamped;
  return `${at.toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;
}

/* ---------------------------------------------------------------------- UID */

/**
 * A stable identifier for one logical occurrence.
 *
 * Built from the same two things that identify an occurrence everywhere else in
 * the app — the placement and the date it has *in the base series*, see
 * `occurrenceIdFor` — so exporting the same range twice produces the same UIDs,
 * and a calendar that was given the first file recognises the second as an
 * update of the same events rather than as duplicates of them.
 *
 * That it survives a move is deliberate and follows from using the series date:
 * a lesson dragged to Tuesday is still the same lesson, at a new `DTSTART`.
 *
 * Placement ids are device-generated (`domain/id`) and already safe here, but a
 * snapshot is input — `parseTimetableSnapshotValue` requires only that an id be
 * a string — so anything outside a conservative set is replaced rather than
 * trusted. Otherwise a crafted id could carry a CRLF and inject a content line.
 */
export function icsUid(placementId: string, occurrenceDate: string): string {
  const safe = placementId.replace(/[^A-Za-z0-9._-]/g, "-");
  return `${safe}-${occurrenceDate}@${UID_DOMAIN}`;
}

/* ----------------------------------------------------------------- writing */

export interface IcsCalendarInput {
  /** The timetable's name, offered to clients as `X-WR-CALNAME`. */
  calendarName: string;
  /** Already resolved and dated by `domain/calendarExport`. Nothing here repeats. */
  occurrences: CalendarOccurrence[];
  /** When the file is being written, as an ISO instant. */
  exportedAt: string;
}

/**
 * The whole file.
 *
 * `METHOD:PUBLISH` because this is a published copy of a schedule and not an
 * invitation: it asks nothing of the person reading it, and there is no
 * `ORGANIZER` or `ATTENDEE` to answer to.
 *
 * There is deliberately no `VALARM` in any event. Temelo has its own reminders,
 * with a lead time the user set per class, and emitting alarms here would give
 * them a second notification for every lesson from a calendar app they did not
 * ask to be reminded by — silently, and with no way to turn it off from Temelo.
 *
 * `X-WR-CALNAME` is a non-standard property that Google, Apple and most others
 * read to name an imported calendar; clients that do not know it ignore it,
 * which is what the `X-` prefix is for.
 */
export function buildIcsCalendar(input: IcsCalendarInput): string {
  const stamp = icsUtcTimestamp(input.exportedAt);

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${ICS_PRODUCT_ID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(input.calendarName)}`,
  ];

  for (const event of input.occurrences) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${icsUid(event.placementId, event.occurrenceDate)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsFloatingDateTime(event.date, event.startTime)}`,
      `DTEND:${icsFloatingDateTime(event.date, event.endTime)}`,
      `SUMMARY:${escapeIcsText(event.summary)}`,
    );
    // Only what the class actually has. An empty `LOCATION:` is not the same as
    // no location — several clients draw the empty field and its label.
    if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  // Folded last, so folding sees finished content lines and never has to know
  // what any of them mean. The trailing CRLF is required: every content line
  // ends with one, including the final `END:VCALENDAR`.
  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}

/* -------------------------------------------------------------- file names */

/**
 * How much of a timetable's name a calendar filename may carry, in code points.
 *
 * Shorter than the `.temelo` budget because the name is only part of this
 * filename: the prefix and the two dates take a further forty characters or so,
 * and the total still has to sit comfortably inside every filesystem limit.
 */
const MAX_CALENDAR_NAME_POINTS = 40;

/**
 * `Temelo - Autumn 2026 - 2026-09-14 to 2027-03-14.ics`.
 *
 * The range is in the name because that is the one thing about this file a user
 * cannot recover from anywhere else once it is sitting in their Downloads
 * folder — an `.ics` has no visible header, and two exports of the same
 * timetable differ only by which weeks they cover. ISO dates rather than
 * localized ones, so the files sort chronologically in a file manager and mean
 * the same thing to whoever the user forwards them to.
 */
export function calendarFileName(timetableName: string, from: string, to: string): string {
  const name = sanitizeFileNameStem(timetableName, MAX_CALENDAR_NAME_POINTS);
  const stem = name.length > 0 ? `Temelo - ${name} - ${from} to ${to}` : `Temelo - ${from} to ${to}`;
  return `${stem}${CALENDAR_FILE_EXTENSION}`;
}
