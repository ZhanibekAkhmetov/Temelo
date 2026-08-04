# Temelo

Temelo is a mobile-first, local-first timetable application for school and
university students.

## Current status

Early scaffold stage. The repository currently contains the default Expo
Router entry screen and root layout only — no timetable UI, onboarding flow,
or data persistence has been implemented yet. Product and architecture
direction are documented in [docs/](docs/) to guide the implementation that
follows.

## Central product concept

Academic institutions run on repeated lesson time slots. Instead of entering
a start and end time for every calendar event, Temelo has the user define
their academic-day structure once (start of day, lesson length, break
length, number of slots) and then fill reusable timetable slots with classes.
This is meant to make creating and editing a timetable much faster than using
a general-purpose calendar app. See [docs/PRODUCT.md](docs/PRODUCT.md) for
the full product definition.

## Technology

Versions below are read directly from [package.json](package.json):

- Expo `~57.0.9`
- React Native `0.86.2`
- React `19.2.3`
- TypeScript `~6.0.3`
- Expo Router `~57.0.9`
- Expo Dev Client `~57.0.10`

The project uses an Expo development build rather than Expo Go, because it
depends on native modules (e.g. `expo-dev-client`, `react-native-reanimated`,
`expo-glass-effect`) that Expo Go does not support.

## Prerequisites

- Node.js and npm
- An Expo development build installed on your device or emulator (see
  [Expo development builds](https://docs.expo.dev/versions/v57.0.0/develop/development-builds/introduction/))
- For Android testing: a physical Android device or emulator (Android is the
  currently tested physical platform)

## Local development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the development server with the dev client:

   ```bash
   npx expo start --dev-client
   ```

3. Open the app from your installed development build.

> Your phone and computer must be able to reach each other on the local
> network for the development build to connect to the Metro bundler.

## Roadmap (high level)

See [docs/ROADMAP.md](docs/ROADMAP.md) for the full milestone breakdown. In
short: project foundation → onboarding UI and state → generated time-slot
preview → local persistence → timetable grid → quick class creation →
editing → reusable courses → recurrence → settings → backup/restore →
calendar export → sync and desktop (future).

## Repository structure

```
src/
  app/          Expo Router routes and layouts only
docs/
  PRODUCT.md      Product definition, flows, terminology
  ARCHITECTURE.md Technical architecture and boundaries
  ROADMAP.md      Milestone plan
app.json          Expo app configuration
eas.json          EAS build profiles
CLAUDE.md         Repository instructions for Claude Code
AGENTS.md         Notes for AI coding agents (imported by CLAUDE.md)
```

As implementation progresses, reusable UI components, domain logic, and a
persistence layer will be added outside `src/app` (see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)).

## Non-goals (current)

- No backend, accounts, or authentication
- No cloud synchronization
- No calendar export or device-calendar integration
- No SQLite or other database dependency yet

These are documented as future possibilities in
[docs/PRODUCT.md](docs/PRODUCT.md), not current requirements.

## Licence

This repository includes an MIT [LICENSE](LICENSE) file, currently carrying
the copyright notice from the original Expo template it was created from.
Confirm with the project owner whether this should be updated before
treating it as the project's final licence terms.
