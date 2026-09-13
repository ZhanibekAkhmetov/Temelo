# Temelo — Product Definition

This document defines what Temelo is for, who it is for, and how it is meant
to behave. It is the product source of truth; implementation status is
tracked separately in [ROADMAP.md](ROADMAP.md).

## Problem statement

School and university timetables are repetitive by nature: the same class
happens in the same room, at the same time, on the same weekday, for an
entire term. General-purpose calendar apps make no use of this repetition —
every event still needs its own start time, end time, and recurrence rule to
be configured by hand. This makes both initial timetable creation and later
edits (a room change, a time swap) slower and more error-prone than they
need to be for something that is fundamentally a small, structured grid.

Temelo treats the academic timetable as its own kind of object, not a
generic calendar, and optimizes entry and editing around that structure.

## Target users

- School and university students building their personal class schedule.
- Users who want their timetable available and usable without a network
  connection.
- Users who do not want to create an account just to keep a timetable on
  their own device.

## Product principles

- **Speed over flexibility, by default.** Common actions (add a class,
  change a room) should take as few taps as possible. Flexibility (custom
  recurrence, exceptions) is available but never required for the common
  case.
- **Timetable-shaped, not calendar-shaped.** The visual layout and data
  model reflect a weekly grid of reusable slots, not a stream of
  independent timed events.
- **Local-first.** All data needed to use the app is stored on the device.
  No account or network connection is required for the initial version.
- **Defaults are starting points, not restrictions.** Every value generated
  during setup (slot times, durations, counts) must remain individually
  editable afterward.

## Initial onboarding flow

### 1. Week configuration

- Choose the first day of the week.
- Choose whether weekends are shown.

### 2. Academic-day configuration

- Start of the academic day.
- Default lesson duration.
- Default break duration.
- Initial maximum number of time slots per day.

These four values are used to generate the initial set of time slots for a
day. The generated slots are a starting point: each one must later be
individually editable (time, duration), and generating them does not lock
the user into that structure.

### 3. Naming the timetable

The user gives the timetable a name, and that is the whole of it. There is no
start date, no end date and no term to configure.

This replaces an earlier onboarding step that asked for a semester start date
and an estimated end date. The end date was always a guess — end-of-term dates
are routinely approximate when a term begins — and it was a guess with teeth:
it silently decided when every recurring class stopped. A user who typed
"December" in September found their timetable emptying out in December for a
reason nothing on screen explained.

So the concept is gone from the product, not merely from the form. See
*Timetable lifecycle* below for what replaced it.

## Class creation flow

Adding a normal class is the most frequent action in the app and must stay
minimal:

1. Tap an empty time slot.
2. Enter a class name.
3. Save.

Defaults applied automatically:

- The day and time slot are already known from what was tapped.
- Recurrence defaults to weekly.
- Recurrence is open-ended: the class repeats until the user changes or
  deletes it.

Everything else is optional at creation time and editable afterward:

- Room (a dedicated field, since it must be visible directly in the
  timetable grid, not buried in a details view).
- Lecturer or teacher.
- Notes.
- Recurrence settings (if plain weekly is not what's wanted).
- For a one-time class, its date. A repeating class has no start date of its
  own to edit: it follows the timetable's start, and an every-two-weeks class
  falls on the half of the fortnight of the week it was added in.
- Visual appearance (e.g. color).

A **course** (e.g. "Mathematics") is a reusable entity, independent of any
single placement. The same course can be placed into multiple weekly slots
without re-entering its name, room, or teacher each time.

## Timetable lifecycle

A user has **one active timetable** and **zero or more archived timetables**.

- The active timetable is the one being used. Its name, the days it shows and
  its academic day are edited on its own screen, reached from a single row in
  Settings.
- Archiving it preserves everything in it — classes, recurrence, exceptions,
  colours, per-class reminders — moves it to the archived list, and stops its
  reminders while it is there. It can be restored later.
- Creating a new timetable while one is active archives the current one, but
  only once the new one has actually been created. Abandoning the setup leaves
  the current timetable completely unchanged.
- Restoring an archived timetable archives the current one first, if there is
  one, and nothing is deleted.
- Only an archived timetable can be deleted permanently, and only behind an
  explicit destructive confirmation.

Archive, restore and delete permanently are three distinct actions with three
distinct consequences, and the product never presents them as variants of each
other.

There may legitimately be **no active timetable**, immediately after the user
archives the one they had. The app then shows an empty state offering to create
a timetable or to look at the archived ones — never an empty grid, which would
read as a timetable that had lost its classes.

Terms, semesters and their dates are not part of this model. A user who thinks
in semesters expresses that by naming a timetable "Autumn 2026" and archiving
it when the autumn ends, which is a decision they make when it is actually true
rather than a date they guess months in advance.

## Editing expectations

Once classes exist, the following actions are expected (not all are part of
the first implementation milestone — see [ROADMAP.md](ROADMAP.md)):

- Edit a placement's details.
- Move a placement to a different slot.
- Duplicate a placement.
- Copy a placement.
- Delete a placement.
- Undo a recent change.
- Choose whether an edit applies to a single occurrence or to the whole
  recurring placement.

## MVP scope

The first implementation milestone covers:

- Setup (timetable name and days shown, then academic-day configuration).
- Generated time slots from onboarding defaults, individually editable.
- A timetable grid view.
- Creating a class in an empty slot with the minimal flow described above.
- Local, on-device persistence of everything above.

## Receiving a timetable from another app

A `.temelo` arriving in Telegram, WhatsApp, mail or Drive is imported with
**Share → Temelo**, and that is a separate, deliberately small experience:

```
Share → Temelo → what is in the file → Import → "Timetable imported" → Done
```

- It is **not** the app. There is no navigation out of it — no Today, no
  Settings, no Timetables — because it is an errand, not a visit. Done returns
  the user to whatever app they shared from.
- It shows the same preview the Import button shows, including the name the
  local copy will actually be created under, and nothing is written until the
  user confirms.
- The imported timetable is seen by opening Temelo normally. Where it landed
  follows the ordinary rule: with a timetable already active it joins the
  archived ones, and with none it becomes the timetable.
- Cancelling, and a file that is not a Temelo timetable, write nothing at all.

The Import button inside Temelo stays, and says so in one line: "Choose a
.temelo file, or share one to Temelo from another app."

## Non-goals (current)

The following are explicitly out of scope for the current implementation
effort:

- No backend, server, or authentication.
- No account of any kind.
- No cloud synchronization between devices.
- No calendar export (Google/Apple/Samsung Calendar or others).
- No direct device-calendar integration.
- No "Open with Temelo" for a `.temelo` file *tapped* in a file manager or a
  chat. Android reports an unknown extension as whatever the provider in the
  middle guesses, so registering for that would be unreliable in exactly the
  place it would be used. Sharing a file *to* Temelo is supported and is the
  documented route — see the share receiver below.
- No duplicate, copy, or undo of a placement. (Move and the
  single-occurrence-vs-recurring edit question, listed as future behaviour
  when this document was written, are now implemented — see
  [ROADMAP.md](ROADMAP.md).)

## Future possibilities

These are directions the product may grow into, not commitments for the
current build:

- A desktop-oriented web application.
- Synchronization between a user's devices.
- Optional accounts, used only to enable synchronization.
- Calendar export to Google Calendar, Apple Calendar, Samsung Calendar, and
  similar applications.
- Direct integration with the device's native calendar.
- Opening a `.temelo` file by *tapping* it outside Temelo — the Android "Open
  with" intent. (Exporting a timetable, sharing it, importing one from inside
  Temelo, and receiving one through another app's share sheet are all
  implemented.)

## Terminology

- **Timetable** — The complete set of a user's recurring class placements
  across a week, displayed as a grid.
- **Active timetable** — The one timetable that is currently being used and
  edited. There may temporarily be none, immediately after the user archives
  the one they had.
- **Archived timetable** — A timetable the user has put away. It is preserved
  exactly, is not editable while archived, schedules no reminders, and can be
  restored, renamed or deleted permanently.
- **Temelo file** — A single timetable written to a `.temelo` file, for
  keeping as a backup or sending to somebody else. It holds the timetable and
  nothing about the person: no appearance or language preference, and no
  reminder history. Importing one always creates a *new copy* on the device, so
  importing your own backup — or the same file twice — is safe. A copy whose
  name is already taken gets the lowest free number after it ("SoSe26 (1)"), so
  two copies are two rows a person can tell apart.
- **Time slot** — A recurring position in the academic-day structure,
  defined by a weekday and a local start/end time, generated from the
  academic-day configuration and individually editable afterward.
- **Course** — A reusable named entity (e.g. "Mathematics") that can be
  placed into one or more time slots without re-entering its details each
  time.
- **Timetable placement** — The association of a course with a specific
  time slot, including placement-specific details such as room, teacher,
  notes, recurrence, and date range.
- **Recurrence** — The rule describing how often a placement repeats
  (default: weekly, open-ended). A one-time placement is the only kind that is
  finite by nature; a repeating one stops only where the user split or deleted
  it.
- **Exception** — A deviation from a placement's normal recurrence for a
  single occurrence (e.g. one week's class is cancelled, moved, or
  modified) without altering the recurring placement itself.
