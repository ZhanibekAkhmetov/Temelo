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
- No test runner is installed yet.

## Architecture boundaries

- `src/app/` — Expo Router routes and layouts ONLY, no substantial logic.
- Reusable UI components live outside `src/app` (e.g. `src/components/`).
- Domain logic (`src/domain/`) must not import React or RN UI primitives.
- Persistence is accessed only through a storage/repository boundary, never
  directly from screens.
- Don't duplicate application data unnecessarily in a global store.
- Recurring lesson times: local weekday + `HH:mm`, not UTC timestamps.
- Academic term dates (date ranges) are modeled separately from recurring
  local lesson times.
- Records intended to be future-sync-able use device-generated string IDs
  plus `createdAt`/`updatedAt`/`deletedAt`.

## Product defaults worth remembering

- Adding a class = tap empty slot → name → save. Defaults to weekly
  recurrence until term end; room/teacher/notes/recurrence/appearance are
  optional and editable later.
- Onboarding order: week config (first day, weekends) → academic-day config
  (start time, lesson/break duration, slot count) → term (start + estimated,
  editable end date). Generated slots must stay individually editable.
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
