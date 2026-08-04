# Temelo — Architecture

This document defines the technical structure and boundaries for Temelo. It
describes intent and rules, not a finished implementation — the codebase is
currently an early scaffold (see the repository README for current status).

## Current stack

Read from the repository's actual configuration, not assumed:

- **Expo** `~57.0.9` (see [package.json](../package.json))
- **React Native** `0.86.2`
- **React** `19.2.3`
- **TypeScript** `~6.0.3`, `strict: true` (see [tsconfig.json](../tsconfig.json))
- **Expo Router** `~57.0.9` (file-based routing, typed routes enabled via
  `experiments.typedRoutes` in [app.json](../app.json))
- **Expo Dev Client** `~57.0.10` — the app runs via a custom development
  build, not Expo Go
- React Compiler is enabled (`experiments.reactCompiler` in app.json)
- Path aliases: `@/*` → `src/*`, `@/assets/*` → `assets/*`
  (see [tsconfig.json](../tsconfig.json))
- Linting: `eslint-config-expo` via flat config
  ([eslint.config.js](../eslint.config.js))
- No test runner, state management library, or persistence library is
  currently installed.

Consult the versioned Expo docs for this exact release before writing
framework-dependent code: https://docs.expo.dev/versions/v57.0.0/

## Folder responsibilities

```
src/
  app/            Expo Router routes and layouts ONLY
  components/     Reusable UI components (presentational + connected)
  domain/         Domain logic and types — no React, no persistence
  storage/        Persistence / repository boundary
```

`components/`, `domain/`, and `storage/` do not exist yet and should be
created incrementally as real code needs them — do not scaffold empty
directories speculatively.

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

Domain logic (timetable generation rules, recurrence calculations, term/date
math, validation) must not import React or any React Native UI primitive.
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
- **Academic term dates** (term start, estimated end) are represented
  separately from recurring local lesson times. A term is a date range; a
  lesson time is a weekday + time-of-day. Mixing the two into one timestamp
  model would make both harder to reason about and edit independently.

## Anticipated local persistence direction

No persistence library is installed yet. The anticipated direction is
**SQLite** (via Expo's SQLite support) for on-device storage, accessed
exclusively through the storage/repository boundary described above. This is
a direction, not a decision to install anything now — no database dependency
should be added until an actual persistence milestone is being implemented
(see [ROADMAP.md](ROADMAP.md)).

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

- No test runner is installed yet.
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

- Exact SQLite access layer/ORM (if any) for persistence.
- State management approach for cross-screen app state, if `src/domain/` +
  local component state turns out to be insufficient.
- Test runner choice and configuration.
- Backup/restore file format.
- Calendar export format/integration mechanism per target platform.
- Synchronization protocol and any future account model.

These should be decided at the point each becomes a concrete implementation
task, informed by what the app actually needs by then — not speculatively
now.
