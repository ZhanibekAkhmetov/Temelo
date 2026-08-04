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

### 3. Academic term setup

The user creates an academic term (or semester) with:

- A start date.
- An estimated end date.
- The end date must be easy to change later — end-of-term dates are
  routinely approximate when the term begins.

## Class creation flow

Adding a normal class is the most frequent action in the app and must stay
minimal:

1. Tap an empty time slot.
2. Enter a class name.
3. Save.

Defaults applied automatically:

- The day and time slot are already known from what was tapped.
- Recurrence defaults to weekly.
- Recurrence continues until the academic term's end date.

Everything else is optional at creation time and editable afterward:

- Room (a dedicated field, since it must be visible directly in the
  timetable grid, not buried in a details view).
- Lecturer or teacher.
- Notes.
- Recurrence settings (if weekly-until-term-end is not what's wanted).
- Start and end dates (if different from the term default).
- Visual appearance (e.g. color).

A **course** (e.g. "Mathematics") is a reusable entity, independent of any
single placement. The same course can be placed into multiple weekly slots
without re-entering its name, room, or teacher each time.

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

- Onboarding (week configuration, academic-day configuration, term setup).
- Generated time slots from onboarding defaults, individually editable.
- A timetable grid view.
- Creating a class in an empty slot with the minimal flow described above.
- Local, on-device persistence of everything above.

## Non-goals (current)

The following are explicitly out of scope for the current implementation
effort:

- No backend, server, or authentication.
- No account of any kind.
- No cloud synchronization between devices.
- No calendar export (Google/Apple/Samsung Calendar or others).
- No direct device-calendar integration.
- No timetable backup/restore feature yet.
- No advanced editing interactions (move, duplicate, copy, undo,
  single-occurrence vs. recurring edits) in the first milestone — these are
  documented above as expected future behavior, not current requirements.

## Future possibilities

These are directions the product may grow into, not commitments for the
current build:

- A desktop-oriented web application.
- Synchronization between a user's devices.
- Optional accounts, used only to enable synchronization.
- Calendar export to Google Calendar, Apple Calendar, Samsung Calendar, and
  similar applications.
- Direct integration with the device's native calendar.
- Timetable backup and restore.

## Terminology

- **Timetable** — The complete set of a user's recurring class placements
  across a week, displayed as a grid.
- **Academic term** — A bounded period (e.g. a semester) with a start date
  and an estimated, editable end date, against which recurring placements
  are scheduled.
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
  (default: weekly, until the academic term's end date).
- **Exception** — A deviation from a placement's normal recurrence for a
  single occurrence (e.g. one week's class is cancelled, moved, or
  modified) without altering the recurring placement itself.
