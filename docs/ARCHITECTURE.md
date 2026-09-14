# Temelo — Architecture

This document defines the technical structure and boundaries for Temelo. It
describes intent and rules rather than a finished implementation; the
repository README carries the current status.

## Current stack

Read from the repository's actual configuration, not assumed:

- **Expo** `~57.0.11` (see [package.json](../package.json))
- **React Native** `0.86.2`
- **React** `19.2.3`
- **TypeScript** `~6.0.3`, `strict: true` (see [tsconfig.json](../tsconfig.json))
- **Expo Router** `~57.0.11` (file-based routing, typed routes enabled via
  `experiments.typedRoutes` in [app.json](../app.json))
- **Expo Dev Client** `~57.0.10` — the app runs via a custom development
  build, not Expo Go
- React Compiler is enabled (`experiments.reactCompiler` in app.json)
- Path aliases: `@/*` → `src/*`, `@/assets/*` → `assets/*`
  (see [tsconfig.json](../tsconfig.json))
- Linting: `eslint-config-expo` via flat config
  ([eslint.config.js](../eslint.config.js))
- No test runner or state management library is installed. Cross-screen state
  is a single React context (`src/state/AppStateContext.tsx`); domain and
  storage checks run through the Node script in `harness/` (`npm run harness`).
- Persistence is `expo-sqlite`, accessed only through `src/storage/`.
- Gestures and animation: `react-native-gesture-handler` and
  `react-native-reanimated`. Reminders: `expo-notifications`. Device language:
  `expo-localization`.

Consult the versioned Expo docs for this exact release before writing
framework-dependent code: https://docs.expo.dev/versions/v57.0.0/

## Folder responsibilities

```
src/
  app/            Expo Router routes and layouts ONLY
  components/     Reusable UI components (presentational + connected)
  domain/         Domain logic and types — no React, no persistence
  features/       Feature-scoped UI and logic (timetable, reminders,
                  dev-only diagnostics)
  i18n/           Translations, locale resolution, formatting
  state/          App state provider and defaults
  storage/        Persistence / repository boundary, and the file formats
                  (`.temelo`, `.ics`)
  theme/          Design tokens, appearance preference, class colours
  types/          Shared model types
  util/           Native-module wrappers (notifications, haptics, files)
```

New directories are added when real code needs them — empty directories are
not scaffolded speculatively.

### `src/app` — routes and layouts only

Contains only Expo Router route files and layout files. A route file may
compose components and call domain/storage functions, but should not contain
substantial business logic itself. This keeps routing concerns (navigation,
screen params) separate from what the screen actually does.

### Reusable UI components

Live outside `src/app` (e.g. `src/components/`). A component becomes
"reusable" once it's used by more than one route, or is clearly generic
(e.g. a time-slot cell, a class card) rather than tied to one screen's
specific layout.

### Domain logic

Domain logic (timetable generation rules, recurrence calculations, date math,
validation) must not import React or any React Native UI primitive.
Domain code should be plain TypeScript that can be unit tested without
rendering anything. This makes the rules that matter most (how slots are
generated, how recurrence resolves) testable independent of the UI.

### Persistence boundary

Screens and components must not read or write storage directly. All
persistence goes through a defined storage/repository interface (e.g.
`src/storage/`). This keeps the eventual choice of storage engine (see
below) from leaking into every screen, and gives a single place to change
when persistence is actually implemented.

## Local-time and date-handling rules

- Recurring academic times (a class's weekday + time) are represented as
  **local weekday and `HH:mm` values** — not immediately converted to UTC
  timestamps. A Monday 09:00 class is "Monday, 09:00" in the data model, not
  a UTC instant, because recurrence is a local, weekly concept and should
  not be re-derived from timezone-sensitive arithmetic.
- **A series' own date range** is represented separately from its recurring
  local lesson time. The range is dates; the lesson time is a weekday plus a
  time-of-day. Mixing the two into one timestamp model would make both harder
  to reason about and edit independently.
- **A repeating series has no end date.** Its `endsOn` carries the sentinel
  `9999-12-31` (`OPEN_ENDED_DATE` in `domain/recurrence`), which every
  existing string comparison already reads correctly; the two places that
  *enumerate* dates rather than test one are the only code that has to know.
  A real end date on a repeating series means it genuinely stops there —
  which, in practice, means a "this and future" edit split it.
- **`startsOn` is a parity anchor, and only sometimes a beginning.** An
  every-two-weeks class's fortnight is counted from its own first occurrence,
  so the anchor is per-series and travels with the series whenever it moves.
  Nothing global anchors it, which is what let the semester start date be
  removed without any existing class changing which weeks it falls on.
  Whether `startsOn` is *also* where the series begins is a separate,
  stored fact — `Placement.startsWithTimetable` (migration v7). An ordinary
  class is part of the timetable's pattern and reaches back as far as the
  timetable does; the later half of a "this and future" split, or a series
  whose start a user chose in an earlier build, genuinely begins on
  `startsOn`. The class editor no longer offers a series start date at all —
  only a one-off's own date — so none of these anchors is a user-facing
  field (`classEditorSchedule` in `domain/classEdit`). It is stored
  rather than derived because the record alone cannot tell "weekly, starts
  5 Oct, added when the timetable began then" from "weekly, starts 5 Oct, the
  later half of a split" — and only the first may extend backwards.
  `seriesLowerBound` in `domain/recurrence` is the one rule.
- **The timetable's start date is a bound, not an anchor.** `Timetable.anchorDate`
  (the "Starts on" field) is applied in `resolveOccurrences` as a lower bound
  on *dates*: every caller — the grid, the clash check, the reminder plan —
  drops dates before it before resolving anything. It is also how far back a
  series that starts with the timetable reaches, so moving it earlier extends
  those classes into the new weeks. It never touches a series' `startsOn`, so
  moving it cannot shift an alternating class's parity, and moving it back and
  forth deletes nothing. It has no end counterpart.
- **Clash checking stays finite** by enumerating only as far as
  `clashHorizon` — the last date the timetable itself names, plus a
  fortnight. Past that point the answer cannot change, because base recurrence
  rules repeat with a period of at most two weeks. See the argument in
  `domain/recurrence`.

## One active timetable, archived snapshots

A user has one active timetable and any number of archived ones, and the two
are stored in deliberately different ways.

- The **active** timetable lives in the normalised working tables
  (`settings`, `time_slots`, `courses`, `placements`,
  `occurrence_exceptions`), plus one `active_timetable` row holding its
  identity. Those tables mean exactly what they meant before the lifecycle
  existed — *the* timetable — so no query, write or diff anywhere in the app
  had to learn about multiple timetables. `active_timetable` has a
  `singleton` primary key `CHECK`ed to one value, so "at most one active
  timetable" is a property of the schema rather than a rule the code keeps; no
  row at all is the legitimate state of a user who archived their only one.
- An **archived** timetable is one row in `archived_timetables`, holding a
  versioned JSON snapshot (`storage/snapshot`). It is not queryable, which
  is the requirement rather than a limitation: archived data is not editable
  in the background, and being unreachable from every ordinary query is what
  stops a bug reaching it.

The alternative — a `timetable_id` column on all four working tables and a
`WHERE` clause on every read — was rejected because it costs four table
rebuilds, changes every query and every diff, and introduces a new way to be
wrong (a forgotten filter shows one timetable's classes inside another) in
order to support editing several timetables at once, which the product does
not do.

Archive, restore and create-new are therefore **swaps**, and each is a single
transaction in `storage/timetableLifecycle`: validate and read everything
first, write in one transaction, and return the state read back from the
database rather than the state the caller hoped for. A snapshot is validated
before a restore touches anything, so a damaged archive is declined with the
active timetable still active.

The snapshot format carries its own `formatVersion`, separate from the
database's `user_version`, because it is a value that outlives the schema
that produced it — and because it is also what a `.temelo` file carries.

## Export and import: the `.temelo` file

A timetable file is a `TimetableSnapshot` inside a small versioned envelope
(`storage/timetableFile`):

```
{ type: "temelo-timetable", formatVersion: 1, exportedAt: <ISO>, timetable: <snapshot> }
```

UTF-8 JSON, extension `.temelo`. The envelope is versioned separately from the
snapshot because the two change for different reasons — the snapshot's version
moves when what a timetable *is* changes, the envelope's when how a file is laid
out does.

Three rules govern it:

- **One representation.** Export writes the same snapshot an archive holds, and
  import validates it with the same `parseTimetableSnapshotValue` a restore uses.
  There is no second model of a timetable for files. Export also parses back
  what it just wrote before sharing it, so a timetable that could not be
  imported is caught here rather than on the recipient's device.
- **A file is untrusted input.** The magic, the envelope version, the snapshot
  version, a length bound before `JSON.parse`, a record-count bound before
  per-record validation, then every field and every reference. `JSON.parse`'s
  result never becomes application state. Nothing is written to the database
  until the user has confirmed a preview, so a malformed file is *declined*
  rather than rolled back.
- **Import clones.** Every id in the file is replaced by a device-generated one
  before the transaction opens, with references remapped consistently
  (`cloneSnapshotWithFreshIds`). A file may come from this very installation, so
  keeping its ids would collide on a primary key — and, worse, would let two
  copies of a class share a reminder identity, which is derived from the
  placement id and occurrence date. Importing the same file twice therefore
  produces two independent timetables.

The file carries the timetable and nothing else: the app-global settings
(appearance, language, default reminder, grid orientation) are excluded by
construction, because the file carries a `TimetableSnapshot` and that is already
bounded by `TIMETABLE_SETTING_KEYS`. The reminder ledger, OS notification
identifiers and SQLite metadata are not in the snapshot and so cannot be in the
file. Per-class and per-occurrence reminder *settings* do travel; reminder
*history* does not.

Importing reuses the lifecycle's transactions: with a timetable active it is one
insert into `archived_timetables`, with none it is the same clear-and-write a
restore performs. An import never displaces the active timetable.

The imported copy is named after the file, with the lowest free `(n)` appended
when the device already has a timetable of that name — "SoSe26 (1)", "SoSe26
(2)". This is the *only* place a name is made unique: a name the user typed is
theirs, and two timetables called "SoSe26" is a choice the app does not overrule.
An import is the one case where the name was nobody's choice, and where the same
file tapped twice in a chat would otherwise produce list rows nothing can tell
apart. The number is chosen inside the import's transaction; the preview
predicts it beforehand so the final name is on screen before the user agrees to
it. The `.temelo` itself is never modified.

Platform access is confined to `util/timetableFiles`, which owns
`expo-file-system` and `expo-sharing` and knows nothing about timetables —
exactly the line `util/notifications` and `util/haptics` already draw. That is
what lets the whole format be exercised by the Node harness, which has no native
modules.

## Calendar export: one way, bounded, materialized

A timetable can also leave as an `.ics` (`storage/calendarFile`), which is the
opposite kind of thing from a `.temelo` and is built that way deliberately.

**One way.** Temelo writes calendar files and never reads one. There is no
`.ics` import, no synchronization, no Calendar Provider or EventKit
integration, and **no calendar permission is requested** — the file goes to the
ordinary share sheet, so the app never gains access to the user's calendar. A
file, once made, does not update: it is a snapshot of a date range, and
re-exporting is how a changed timetable reaches a calendar again.

**Bounded.** A timetable has a start and no end, so "export all of it" is not a
finite request. The user picks a range; `domain/calendarExport` caps one export
at 366 days and suggests six months from today (from the archive's own start
date, for an archive).

**Materialized, not `RRULE`.** This is the load-bearing decision. Temelo's
editing model is richer than iCalendar recurrence — an occurrence can be moved
to another day and period, cancelled on its own, or split off by a "this and
future" edit — and expressing that as `RRULE`/`RDATE`/`EXDATE` would be a
second implementation of recurrence whose bugs would surface inside somebody
else's calendar app. Because the range is finite, none is needed: the exporter
enumerates the dates and asks **`resolveOccurrences`** — the same function the
grid draws from, the clash check asks and the reminder plan is built on — then
writes one `VEVENT` per resolved occurrence. A cancelled occurrence emits
nothing, a moved one emits exactly one event at the date it moved to, and a
split series is two ordinary runs. `harness/calendar.mjs` suite H asserts the
exported set equals the resolver's set over several ranges, which is what stops
the two drifting apart.

**Floating times, because Temelo has no timezone.** A recurring class is stored
as a local weekday and an `HH:mm`; no timezone is stored anywhere in the model.
So `DTSTART`/`DTEND` are written as RFC 5545 floating date-times — no `Z`, no
`TZID` — which preserves exactly what Temelo means ("Maths is at 09:00").
Inventing a `TZID` from the exporting device would claim knowledge of the
institution's zone the app does not have, and would shift every class by an hour
for a user who exported in one country and read the file in another. `DTSTAMP`
is a real instant and so is correctly UTC.

The file is RFC 5545: CRLF line endings, TEXT escaping of backslash, comma,
semicolon and newline, and folding at **75 octets** — counted in UTF-8 bytes
over whole code points, so a Cyrillic or emoji name is neither over-long nor cut
in half. UIDs are derived from the placement id and the occurrence's date *in
its series*, the same pair that identifies an occurrence everywhere else, so
re-exporting the same range is byte-identical and a calendar recognises an
update rather than duplicates. No `VALARM` is ever emitted: Temelo has its own
reminders, and a second set from a calendar app is not something the user asked
for.

Export is read-only for both the active timetable and an archived one. Both
arrive as a `TimetableSnapshot`, so there is one code path; an archive is read
from its stored snapshot and never restored, and nothing is written to SQLite in
order to export. A range holding no occurrences is reported to the user and
never shared as an empty calendar, which would look exactly like a successful
export until they went looking for their classes.

Filename sanitization is shared with the `.temelo` exporter
(`storage/fileName`) so that what a filesystem accepts is decided in one place,
and the platform boundary is the same `util/timetableFiles` — which gained only
an optional iOS UTI, since `.ics` has a registered one and `.temelo` does not.
No native module, permission or `app.json` change was needed for any of this.

## Receiving a share: a transient receiver, not a screen

On Android, another app's share sheet can send a `.temelo` to Temelo. The
receiving experience is deliberately **not** the app:

```
Telegram → Share → Temelo → preview → Import → "Timetable imported" → Done
```

and Done leaves. The imported timetable is seen the way every other timetable is
seen: by opening Temelo.

- **`expo-sharing`'s config plugin registers the intent filter**, on
  `MainActivity`, for `ACTION_SEND` of `application/octet-stream` — the type
  Temelo writes and the type every messenger reports for an extension Android
  has no mapping for. There is no `ACTION_VIEW` registration: "open a `.temelo`
  with Temelo" is best-effort at the mercy of whichever provider is in the
  middle, and Share → Temelo is the supported entry.
- **`app/+native-intent.ts` stops a navigation rather than starting one.** A
  send carries no URI, so `expo-sharing` fabricates the deep link
  `temelo://expo-sharing` for the benefit of navigation libraries. Expo Router
  would resolve that to `+not-found`. `redirectSystemPath` recognises it and
  answers with the app's ordinary entry path on a cold launch and with the empty
  string — Expo Router's "do not navigate" — on a warm one. See
  `domain/incomingShare`.
- **`features/timetables/ShareReceiver` draws the whole errand as an overlay.**
  It is mounted once by the root layout beside the navigator, imports no router,
  and has six states. It finds its payload by asking `expo-sharing` on mount and
  on every return to the foreground, rather than by being told.
- **Done, Close and Cancel all call `BackHandler.exitApp()`**, which is the
  activity's default back behaviour: at the root of a task entered from another
  app that finishes the task and reveals the sender. It also means no Temelo
  task is left holding a consumed share.

The rule this encodes, and the reason it is written down: **an arrival changes
what is drawn, never where the app is.** Earlier attempts made the incoming file
a route, and every failure was the same one — a `push`/`replace` resolved
against a navigation state whose `<Stack>` had not mounted is built with
`target: undefined` and reaches only Expo Router's internal slot navigator,
producing "the action ... was not handled by any navigator". `navigationRef.isReady()` is already
true when that happens, so no readiness check catches it.
Removing the navigation removes the failure; `harness/architecture.mjs` asserts
that the receiver still has no router to call.

The payload is read into memory and cleared from the native singleton as soon as
the bytes arrive, before the user answers — so an import never depends on a
`content://` grant Android may revoke in the meantime, and a redelivered intent
(Android redelivers the launching intent when a reclaimed task is resumed)
cannot present the same file twice.

None of this can be proven off-device. The harness proves the decisions and the
sequencing; task and activity behaviour is a device checklist.

## Local persistence

On-device storage is **SQLite** via `expo-sqlite`, reached exclusively
through the storage boundary described above. No ORM.

- `src/storage/database.ts` opens the database and sets `journal_mode=WAL`,
  `foreign_keys=ON` and a busy timeout on the one connection everything
  else uses.
- `src/storage/migrations.ts` holds an ordered, versioned migration list
  keyed off SQLite's own `PRAGMA user_version`. Schema changes are appended
  as a new version; shipped migrations are never edited in place.
- `src/storage/timetableRepository.ts` is the only module that writes SQL
  for timetable data. It loads the whole timetable and saves whole-timetable
  diffs in a single transaction, because one recurring edit can touch
  several records at once and none of them may land without the others.
- `src/storage/bootstrap.ts` memoizes startup so the open/migrate/load
  sequence runs exactly once per launch.
- `AppStateProvider` is the only consumer. `BootGate` holds rendering back
  until hydration finishes, so no screen ever sees an empty state that could
  then be written over stored data.

## Future synchronization considerations

Synchronization across devices is a future possibility, not a current
requirement (see [PRODUCT.md](PRODUCT.md)). To avoid painting the data model
into a corner:

- Records that may eventually sync should use **device-generated string
  IDs** (not auto-incrementing integers scoped to one device/database).
- Such records should include `createdAt`, `updatedAt`, and `deletedAt`
  fields from the start, even before any sync mechanism exists, so that
  future sync logic has the timestamps it needs without a data migration.
- Beyond those two conventions, synchronization must not complicate the
  first MVP — no conflict resolution, sync protocol, or backend should be
  designed or implemented now.

## Testing strategy (high level)

- No test runner is installed yet. What exists is `harness/` — a Node script
  (`npm run harness`) that runs domain and storage checks directly, with
  `expo-sqlite` redirected to Node's built-in SQLite. It is a stopgap, not a
  substitute for a real runner.
- Domain logic (`src/domain/`) is the highest-value target for unit tests,
  since it is plain TypeScript and encodes the rules most likely to have
  edge cases (slot generation, recurrence, date math).
- UI/component testing is a lower near-term priority than domain logic
  coverage, given the current project stage.
- `harness/architecture.mjs` is the one suite that reads source files rather
  than exercising modules. It guards design properties whose violation would
  only show up on a physical device — today, that the share receiver has no
  router to call. Keep it small: a check belongs there only when the failure it
  prevents cannot be reproduced in Node at all.
- `harness/calendar.mjs` checks the `.ics` against RFC 5545 literally rather
  than through a library — a library sharing the same misunderstanding would
  prove nothing — and asserts the exported event set equals what
  `resolveOccurrences` produces. It cannot prove that any particular calendar
  application accepts the file; that is a device check.
- **Nothing in the harness can prove Android task or activity behaviour.**
  Which task a share-launched activity lands in, whether Done returns the user
  to the sending app, and what the Expo dev client does to the task on the way
  are device questions. They are verified with `adb shell dumpsys activity
  activities` and a physical phone, not here.
- Adding a test runner (e.g. Jest, per Expo's own guide) should happen when
  there is domain logic worth testing, not preemptively.

## Dependency policy

- Do not add, remove, or upgrade dependencies without a concrete
  requirement driving the change.
- No backend, authentication, synchronization, calendar-integration, or
  database dependency until its corresponding roadmap milestone is actually
  being implemented.
- Prefer solving problems with the existing stack (Expo, React Native,
  TypeScript) before reaching for a new package.

## Intentionally deferred decisions

The following are recognized as open questions, deliberately not decided
yet:

- Test runner choice and configuration.
- Calendar export format/integration mechanism per target platform.
- Synchronization protocol and any future account model.

These should be decided at the point each becomes a concrete implementation
task, informed by what the app actually needs by then — not speculatively
now.
