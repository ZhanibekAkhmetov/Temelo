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
  storage/        Persistence / repository boundary
  theme/          Design tokens, appearance preference, class colours
  types/          Shared model types
  util/           Native-module wrappers (notifications, haptics)
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
- **`startsOn` is a parity anchor, not just a beginning.** An
  every-two-weeks class's fortnight is counted from its own first occurrence,
  so the anchor is per-series and travels with the series whenever it moves.
  Nothing global anchors it, which is what let the semester start date be
  removed without any existing class changing which weeks it falls on.
- **The timetable's start date is a bound, not an anchor.** `Timetable.anchorDate`
  (the "Starts on" field) is applied in `resolveOccurrences` as a lower bound
  on *dates*: every caller — the grid, the clash check, the reminder plan —
  drops dates before it before resolving anything. It never touches a
  series' `startsOn`, so moving it cannot shift an alternating class's parity,
  and moving it back brings earlier occurrences back unchanged. It has no end
  counterpart.
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
that produced it — and because the next feature writes it to a file the user
keeps. File export and import are not implemented.

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
- Backup/restore file format.
- Calendar export format/integration mechanism per target platform.
- Synchronization protocol and any future account model.

These should be decided at the point each becomes a concrete implementation
task, informed by what the app actually needs by then — not speculatively
now.
