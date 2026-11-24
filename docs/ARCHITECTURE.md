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
- No state management library is installed. Cross-screen state is a single
  React context (`src/state/AppStateContext.tsx`).
- Tests run on Node's built-in test runner (`npm test`, suites in `tests/`);
  no test dependency is installed. See "Testing strategy".
- Persistence is `expo-sqlite`, accessed only through `src/storage/`.
- Gestures and animation: `react-native-gesture-handler` and
  `react-native-reanimated`. Reminders: `expo-notifications`. Device language:
  `expo-localization`.
- Web: the same app through `react-native-web` and Metro (`npm run web`),
  with a desktop layout from 1024 px — see "Web build" below.
- Server (optional, `server/`): Java 21, Spring Boot `4.2.0`, PostgreSQL 18,
  Flyway, springdoc-openapi `3.2.1`, Maven wrapper — see "The optional
  server" below. A separate project
  with its own build; the app has no dependency on it.

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

Beside `src/`, `server/` holds the optional Spring Boot service. Nothing in
`src/` imports from it or names it, and it never imports app code.

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
  whose start the user chose, genuinely begins on `startsOn`. Since Beta 2
  the editor offers that choice again — "Starts: with the timetable / on a
  chosen date" — and a chosen date is exactly this existing structure:
  `startsOn` = the date, `startsWithTimetable` = false, so an alternating
  class counts its fortnight from the first lesson on or after it. Untouched
  controls pass every stored anchor through unchanged
  (`classEditorSchedule` in `domain/classEdit`), a start change applies to
  the whole series only, and an "all" edit that rewrites the rule retires the
  exceptions the new rule no longer has an occurrence for (keeping those
  before the new start, so moving it back restores them). It is stored
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
- **A clash is a question, not a veto** (Beta 2). Detection is unchanged, but
  every write path — `upsertPlacement`, `movePlacement`,
  `applyClassEditScope` — takes `allowOverlap`. Without it an overlap comes
  back as an `OverlapRefusal` naming the class in the way, and the screen
  asks "Save anyway?" through `ConfirmDialog`. An edit that cannot change
  which cells a class occupies (a rename, a room, a reminder) is never asked,
  so an accepted overlap is not raised again. Overlapping classes stay two
  placements with their own occurrences, reminders and exported events.
  `resolveWeekClasses` keeps a list per cell; the vertical grid lays a group
  of overlapping blocks out in side-by-side lanes (`assignLanes`), and a tap
  on a cell holding more than one class opens a chooser rather than guessing
  from a narrow lane.
- **Visible weekdays are presentation.** `Settings.visibleWeekdays` (migration
  v8) is any non-empty, Monday-first subset of the week, carried per timetable
  in snapshots. Only the grid reads it; `resolveOccurrences`, the reminder
  plan and the calendar export never do, so a class on a hidden day keeps
  every occurrence and comes back when the day is shown again. The Beta 1
  preset is still written — `settings.weekend_mode` and the snapshot's
  `weekendMode` — as the narrowest preset that covers the visible days
  (`weekendModeCovering`), because that is all an older build reads; a
  snapshot without `visibleWeekdays` (Beta 1) is read from the preset. The
  snapshot format version therefore did not change.

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
what lets the whole format be exercised by the Node tests, which have no native
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
split series is two ordinary runs. `tests/calendar.test.mjs` test H asserts the
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
Removing the navigation removes the failure; `tests/architecture.test.mjs` asserts
that the receiver still has no router to call.

The payload is read into memory and cleared from the native singleton as soon as
the bytes arrive, before the user answers — so an import never depends on a
`content://` grant Android may revoke in the meantime, and a redelivered intent
(Android redelivers the launching intent when a reclaimed task is resumed)
cannot present the same file twice.

None of this can be proven off-device. The tests prove the decisions and the
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

## Web build

The browser version is the same app, bundled by Metro for web (`npm run web`;
`expo export --platform web` for the static build). There is no second
codebase and no second data model.

- **Storage** is `expo-sqlite`'s web build — SQLite compiled to WebAssembly,
  running in a worker, persisted in the Origin Private File System. Labelled
  *alpha* in the Expo 57 docs; everything above `src/storage/` is unaware of
  it. It needs `SharedArrayBuffer`, so the page must be cross-origin isolated:
  [metro.config.js](../metro.config.js) serves `.wasm` and sends
  `Cross-Origin-Embedder-Policy: credentialless` and
  `Cross-Origin-Opener-Policy: same-origin`, and any host of the static build
  must send the same two headers.
- **Platform edges are `.web.ts` twins** of the `src/util/` wrappers. Metro
  picks `x.web.ts` over `x.ts` for web; TypeScript only ever checks callers
  against `x.ts`, so each web export is typed `typeof Native.x`, and
  `tests/architecture.test.mjs` (test AC) asserts that each twin exports
  exactly the native file's names and imports no module at runtime.
- **One tab at a time.** The OPFS handles the database lives in are exclusive,
  so `util/storageClaim.web.ts` takes a Web Lock before `bootstrap` opens
  anything. A tab that cannot get it throws `StorageInUseError`, and
  `BootGate` shows a notice instead of the app — deliberately *not* the
  in-memory fallback, which would let that tab's edits look saved and vanish.
  The same moment requests `navigator.storage.persist()`.
- **Files**: sharing downloads the file (the system share sheet on touch
  devices that can share files); importing uses the browser's file chooser,
  through the same parser, preview and cloning import as on a phone. "Open in
  calendar" is Android-only, so an `.ics` is downloaded.
- **Desktop layout** is decided by one hook, `theme/useIsDesktop` — web and
  at least 1024 px wide; never on a phone. It switches the timetable route to
  `features/desktop/` (toolbar, sidebar, About dialog), gives `GridBlock` its
  desktop geometry, lets the surface grow periods to fill the window
  (`readableSlotHeight`), and turns `ScreenContainer` into a column, a card
  (`desktopCard`) or a dialog (`desktopDialog`). Dialog routes are presented
  as `transparentModal` (`theme/desktopDialog`) so the week stays drawn
  beneath; Expo Router's own web modal is not used because in SDK 57 it sits
  behind an unstable CLI flag. A dialog route loaded straight from its URL has
  nothing beneath it and falls back to a page.
- **Desktop sidebar.** One card per subject — timetable, view (days shown,
  layout), general (appearance, language), reminders — each control with its
  label above it, About as a footer link. One-choice settings apply in place
  (`SegmentedControl`, weekday chips); language and the default reminder are
  `FieldRow`'s `select` appearance, which opens the same small pop-up the
  phone uses. Settings and the sidebar share their option lists and the
  reminder hint through `features/settings/options`.
- **Sheets become dialogs.** Every bottom sheet (scope question, share/export,
  slot chooser, calendar export, date picker) takes its placement from
  `theme/useSheetFrame`: empty on a phone, a centred 480 px card on a desktop.
  The class editor, a full-screen modal on a phone, is a centred card too.
- **Web-only workarounds**, each guarded so native is untouched:
  `runOnUISync` does not exist on web (Reanimated keeps shared values on the
  JS thread), so the surface's week jump runs its settle directly there; and a
  mouse wheel produces no drag or momentum events, so `WheelPicker` schedules
  its settle on every scroll step on web and snaps once scrolling stops.
- **Not on web**: reminders (permission reads as `"unavailable"`, and the
  reminder fields say where reminders work; lead times are still stored and
  travel in a `.temelo`), haptics, and receiving a share from another app.

## The optional server

`server/` is a Spring Boot application (scaffolded in milestone 14.4) that
shares a timetable as a link (the API in 14.5, the app's side in 14.6). It is
additive: the phone app and the web app keep working, unchanged, with no
server running at all.

- **Separate project.** Java 21, Spring Boot 4.2 (Spring Web MVC, Bean
  Validation, Spring Data JPA), built with Maven through the committed
  wrapper (`mvnw`, `mvnw.cmd`), so neither Maven nor PostgreSQL needs
  installing. Its dependencies live in `server/pom.xml` only; the Expo app's
  `package.json` is untouched by it. It was generated with Spring Initializr
  under a placeholder group and moved to `com.zhanibekakhmetov.temelo.server`
  locally.
- **PostgreSQL in Docker.** `server/compose.yaml` runs PostgreSQL 18 for
  development, published on `127.0.0.1:5433` — not 5432, so that a PostgreSQL
  installed on the machine cannot clash with it (`TEMELO_DB_PORT` moves it;
  the server reads the same variable). Its credentials exist only for that
  container.
- **Flyway owns the schema**, from `src/main/resources/db/migration`;
  Hibernate runs with `ddl-auto=validate` and never alters a table.
  `V1__create_shared_timetables.sql` is the first migration. Shipped
  migrations are never edited, as on the app side. `open-in-view` is off.
- **Health.** `GET /api/health` answers `200 {"status":"UP","database":"UP"}`
  or `503` with `DOWN`, decided by `Connection.isValid` on a pooled
  connection. It is a plain controller rather than Spring Boot Actuator,
  which was not among the dependencies approved for 14.4. The body names no
  host, version or error, and the pool gives up on a connection after 5 s so
  the check answers promptly with the database gone.
- **Organised by feature** (`health/`, `share/`), not by layer.
- **The server is never trusted by the app.** Whatever the app downloads from
  it is validated with the same snapshot validator a restore uses, and
  imported through the same cloning import (14.6).

### Share links (`server/.../share/`)

- **A share is a stored `.temelo` file**, never a second representation of a
  timetable. `POST /api/shares` takes the file as `application/json` and
  answers `201` with `{id, expiresAt}` and a relative `Location`;
  `GET /api/shares/{id}` returns the file exactly as uploaded. The envelope is
  kept in a `text` column, not `jsonb`, because the server never queries
  inside a timetable and the link must return the very file that was shared.
- **The server checks the envelope, not the timetable.**
  `TemeloEnvelopeValidator` mirrors the first four steps of the app's
  `parseTemeloFile` — the `temelo-timetable` type, `formatVersion` 1,
  exactly the four envelope fields, the snapshot's object and array shape,
  and at most `MAX_TEMELO_FILE_RECORDS` (20,000) records — and stops there.
  Rebuilding every record would put a second definition of a timetable in
  Java; the app re-validates every download anyway. A newer *snapshot*
  version inside a known envelope is accepted, for the app to judge. The
  bytes are decoded as strict UTF-8 before parsing, so the stored text is
  exactly the text that was checked.
- **Size** is bounded while reading (`BoundedRequestBody`): refused from
  `Content-Length` when there is one, otherwise after one byte over the
  limit (1 MB, `temelo.share.max-size`), so an oversized chunked upload is
  never held whole.
- **No accounts; the id is the key.** 128 bits from `SecureRandom` as 22
  URL-safe characters (`ShareIds`) — unguessable, not merely unique. A
  malformed id is answered 404 before any query.
- **Expiry** (`temelo.share.ttl`, two weeks) is enforced on every read, and
  an expired link answers exactly like one that never existed. An hourly
  `@Scheduled` purge deletes expired rows; it only reclaims space, so a host
  that suspends an idle server costs storage, not correctness. Time comes
  from an injected `Clock`, which the tests move.
- **Refusals are RFC 9457 problem details** with a stable `reason`
  (`too-large` 413, `not-temelo`, `unsupported-version` and `malformed`
  422, `not-found` 404) for the app to map to its own localized message;
  `detail` is for logs. Spring MVC's own errors (415, 405) use the same
  format (`spring.mvc.problemdetails.enabled`).
- **OpenAPI** is generated from the controllers by springdoc-openapi
  (approved in 14.5): `/v3/api-docs` and Swagger UI at `/swagger-ui.html`,
  both public on purpose. The request example is
  `openapi/example-timetable.temelo`, a real file written by the app's
  `buildValidatedTemeloFile`, which the tests also share.
- **Not yet:** CORS for the web app's origin (14.6) and rate limiting of
  uploads (to decide with hosting in 14.7).

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

- **Node's built-in test runner** (`node --test`, Node 22), chosen in
  milestone 14.3 over Vitest and Jest because it needs no dependency and the
  suites already ran on Node: `npm test`, `npm run test:watch`,
  `npm run test:coverage`. `tests/support/setup.mjs` is loaded first
  (`--import`); it registers `resolve-hook.mjs` — the `@/` alias, and
  `expo-sqlite` redirected to `sqlite-stub.mjs` over Node's own SQLite — and
  sets `__DEV__`. Node strips the TypeScript in `src/`, so the real code runs
  uncompiled.
- The suites (`tests/*.test.mjs`) are the former harness, one `test(...)` per
  section. Their assertions keep the harness's sentence-first `check` and
  `equal` (`tests/support/assertions.mjs`), which now throw through
  `node:assert`, so a test stops at its first failing check. Steps that share a
  fixture (calendar, transfer) run in order in one file, as top-level tests do;
  each storage suite opens its own temporary database, so files run in
  parallel safely.
- New tests may be written in TypeScript (`tests/*.test.ts`) with `describe` /
  `it` and `node:assert`; they are type-checked by `npx tsc --noEmit`. Expo's
  base tsconfig limits global types to React Native's, so such a file starts
  with `/// <reference types="node" />` — `@types/node` arrives with Expo,
  not as a dependency of ours.
- Domain logic (`src/domain/`) is the highest-value target for unit tests,
  since it is plain TypeScript and encodes the rules most likely to have
  edge cases (slot generation, recurrence, date math).
- UI/component testing is a lower near-term priority than domain logic
  coverage, given the current project stage.
- `tests/architecture.test.mjs` is the one suite that reads source files rather
  than exercising modules. It guards design properties whose violation would
  only show up on a physical device — today, that the share receiver has no
  router to call. Keep it small: a check belongs there only when the failure it
  prevents cannot be reproduced in Node at all.
- `tests/calendar.test.mjs` checks the `.ics` against RFC 5545 literally rather
  than through a library — a library sharing the same misunderstanding would
  prove nothing — and asserts the exported event set equals what
  `resolveOccurrences` produces. It cannot prove that any particular calendar
  application accepts the file; that is a device check.
- **Nothing in the tests can prove Android task or activity behaviour.**
  Which task a share-launched activity lands in, whether Done returns the user
  to the sending app, and what the Expo dev client does to the task on the way
  are device questions. They are verified with `adb shell dumpsys activity
  activities` and a physical phone, not here.
- Component tests (React Native rendering) would need a different runner —
  Jest with `jest-expo` — and are not planned; the web build is checked in a
  real browser instead.
- **The server has its own tests**, JUnit 5 through `./mvnw test` in
  `server/`, separate from `npm test`. Web-layer tests (`@WebMvcTest`,
  MockMvc) replace the database with a Mockito mock, which is the only way
  to see the "database down" answers; application tests start the whole
  server against a real PostgreSQL via Testcontainers, on the image
  `compose.yaml` uses, so they need a running Docker daemon. Rules that need
  neither (the envelope validator, the bounded body) are plain unit tests.
  Expiry is tested by moving an injected `Clock`, not by waiting. Mockito is
  loaded as a `-javaagent` by Surefire instead of attaching itself at
  runtime.

## Dependency policy

- Do not add, remove, or upgrade dependencies without a concrete
  requirement driving the change.
- No backend, authentication, synchronization, calendar-integration, or
  database dependency until its corresponding roadmap milestone is actually
  being implemented.
- The same rule holds in `server/`: its dependencies are exactly the ones
  approved for milestone 14.4 (Spring Web, Validation, Data JPA, PostgreSQL,
  Flyway, Testcontainers) and 14.5 (springdoc-openapi with Swagger UI), and
  anything beyond them is asked for first.
- Prefer solving problems with the existing stack (Expo, React Native,
  TypeScript) before reaching for a new package.

## Intentionally deferred decisions

The following are recognized as open questions, deliberately not decided
yet:

- Calendar export format/integration mechanism per target platform.
- Synchronization protocol and any future account model.

These should be decided at the point each becomes a concrete implementation
task, informed by what the app actually needs by then — not speculatively
now.
