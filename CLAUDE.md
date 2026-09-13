@AGENTS.md

# Temelo — repository instructions

Temelo is a mobile-first, local-first timetable app for school/university
students. Full product definition: [docs/PRODUCT.md](docs/PRODUCT.md).
Architecture rules and rationale: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Milestone plan: [docs/ROADMAP.md](docs/ROADMAP.md).

## Stack

Expo `~57.0.9`, React Native `0.86.2`, React `19.2.3`, TypeScript `~6.0.3`
(strict), Expo Router `~57.0.9`, Expo Dev Client. Verify exact versions in
[package.json](package.json) before assuming — do not guess. Runs via a
development build, not Expo Go.

## Commands

- `npx expo start --dev-client` — run the app (phone and computer must share
  a local network)
- `npm run lint` — lint (`expo lint`); run after code changes
- `npm run harness` — the geometry, storage, lifecycle and transfer harnesses
  (`harness/`), run against Node's own SQLite. There is no test runner; this
  is the substitute, and it must stay green.

## Architecture boundaries

- `src/app/` — Expo Router routes and layouts ONLY, no substantial logic.
- Reusable UI components live outside `src/app` (e.g. `src/components/`).
- Domain logic (`src/domain/`) must not import React or RN UI primitives.
- Persistence is accessed only through a storage/repository boundary, never
  directly from screens.
- Don't duplicate application data unnecessarily in a global store.
- Recurring lesson times: local weekday + `HH:mm`, not UTC timestamps.
- A series' date range is modeled separately from its recurring local lesson
  time. A repeating series is open-ended (`OPEN_ENDED_DATE` in
  `domain/recurrence`); a real end date on one means it genuinely stops
  there, which in practice means a "this and future" edit split it.
- `startsOn` is always a per-series parity anchor; nothing global anchors
  biweekly recurrence. It is also the series' first date only when
  `startsWithTimetable` is false (a split's later half, or a start the user
  picked in the editor). Otherwise the series reaches back as far as the
  timetable does — see `seriesLowerBound` in `domain/recurrence`.
- One active timetable lives in the normalised working tables; archived ones
  are versioned JSON snapshots in `archived_timetables`. Archive, restore,
  create-new and import are atomic swaps in `storage/timetableLifecycle`.
- A `.temelo` file is a `TimetableSnapshot` in a versioned envelope
  (`storage/timetableFile`) — never a second representation of a timetable.
  Validate an incoming one with the same snapshot validator a restore uses,
  and never write anything before the user has confirmed the preview.
- Importing always clones: every id is replaced with a device-generated one
  and references remapped, because a file may come from this very device and
  a shared placement id would also mean a shared reminder identity.
- `expo-file-system` and `expo-sharing` are reached only through
  `src/util/timetableFiles.ts`; nothing above it names a native file module,
  and nothing in it knows what a timetable is.
- Records intended to be future-sync-able use device-generated string IDs
  plus `createdAt`/`updatedAt`/`deletedAt`.

## Product defaults worth remembering

- Adding a class = tap empty slot → name → save. Defaults to open-ended
  weekly recurrence; room/teacher/notes/recurrence/appearance are optional and
  editable later.
- Setup order: timetable (name, starts on, days shown) → academic day (start
  time, lesson/break duration, slot count), then the timetable is created.
  Generated slots must stay individually editable.
- A timetable has one start date ("Starts on", stored as v6's `anchor_date`)
  and no end date. It is a lower bound on occurrences — nothing is drawn,
  clash-checked or reminded before it — never a re-anchor: changing it
  rewrites no placement. Moving it earlier extends every series that starts
  with the timetable into the new weeks. The calendar stays navigable before it.
- Naming a timetable is optional. A blank name becomes a localized default
  ("Timetable1", "Timetable2", … — the lowest free number), chosen only when
  creation commits.
- A repeating class has no user-facing start date; only a one-off's date is
  editable. `startsOn`, parity and split anchors are internal structure.
- Lifecycle confirmations (archive, restore, delete, replace) use
  `ConfirmDialog`, never the platform `Alert`.
- There is no automatic archiving and no end date; archiving is always the
  user's explicit action.
- There is no user-facing "term", "semester start" or "semester end". Do not
  reintroduce one. A user who thinks in semesters names a timetable and
  archives it.
- There may legitimately be no active timetable. Every screen that draws
  timetable data must answer for `state.timetable === null`.
- A course is reusable across multiple placements.

## Coding rules

- No backend, auth, sync, calendar integration, or database until the
  corresponding roadmap milestone is actually being implemented.
- Do not add, remove, or upgrade dependencies without explicit instruction.
- Never run `npm audit fix --force`.
- Prefer small, reviewable changes.
- Run `npm run lint` after code-related changes.

## Process rules

- Read the relevant existing files before editing them — don't assume.
- If a requirement is ambiguous or unstated, state the assumption you're
  making rather than silently inventing one.
- Never commit or push unless the user explicitly asks for it in that
  message.
