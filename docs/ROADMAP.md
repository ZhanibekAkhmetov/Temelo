# Temelo — Roadmap

Small, ordered milestones. Each has a concise completion condition. This is
a planning document, not a status report — see the repository README for
current implementation status.

1. **Project foundation**
   Repository, Expo Router app shell, TypeScript strict mode, linting, and
   project documentation (this doc set) are in place.
   *Done when:* the app builds and runs via `npx expo start --dev-client`
   on a development build with no timetable feature code yet, and
   README/docs accurately describe the project.

2. **Static onboarding UI**
   Non-functional screens for week configuration, academic-day
   configuration, and term setup, matching the flow in
   [PRODUCT.md](PRODUCT.md).
   *Done when:* a user can navigate through all onboarding screens in order
   and back, with no state persisted or validated yet.
   *Status: superseded.* Implemented directly as functional screens (see
   milestone 3) as part of the interaction prototype.

3. **Onboarding state and validation**
   Onboarding screens hold real input state and validate it (e.g. end date
   after start date, non-zero durations).
   *Done when:* invalid input is rejected with feedback, and valid input
   from all onboarding screens is held in memory as a single, coherent
   onboarding result.
   *Status: done*, as part of the in-memory interaction prototype. State is
   held only in memory for this milestone (see milestone 5) — it does not
   yet survive an app restart.

4. **Generated time-slot preview**
   Time slots are generated from the academic-day configuration and shown
   to the user before they finish onboarding.
   *Done when:* changing any academic-day input updates the previewed
   slots, and the user can see exactly what slots onboarding will produce.
   *Status: done*, as part of the in-memory interaction prototype.

5. **Local persistence**
   A storage/repository boundary (per [ARCHITECTURE.md](ARCHITECTURE.md))
   is implemented so onboarding results and generated slots survive an app
   restart.
   *Done when:* completing onboarding, then closing and reopening the app,
   shows the same term, slots, and settings without re-running onboarding.
   *Status: done.* SQLite (`expo-sqlite`) behind `src/storage/`, with
   versioned migrations, WAL and foreign keys on, hydration gated before
   first render, and every successful `AppState` mutation written back as a
   transactional diff. See "Local persistence" in
   [ARCHITECTURE.md](ARCHITECTURE.md).
   *Temporary:* a one-time import seeds a never-initialized database from
   the legacy in-memory sample timetable
   (`src/storage/legacySeedMigration.ts`); it is to be removed together with
   `src/state/seed.ts` once the personal timetable has been confirmed
   migrated on device.

6. **Empty timetable grid**
   A timetable screen renders the generated time slots as an empty weekly
   grid, honoring first-day-of-week and weekend-visibility settings.
   *Done when:* the grid layout correctly reflects onboarding settings with
   no classes placed yet.
   *Status: done*, as part of the in-memory interaction prototype — the
   grid also already renders placed classes (see milestone 7).
   *Usability repair:* physical-device testing found the grid axes
   transposed (weekdays as columns, periods as rows). Corrected to
   weekdays-as-rows with a fixed weekday column and periods-as-columns in a
   synchronized horizontal scroll area, with the visible period on open set
   to the academically relevant one. First-day-of-week now supports all
   seven weekdays (previously only Monday/Sunday), and the quick-add/edit
   editor was changed from a bottom sheet (obscured by the Android
   keyboard) to a full-screen modal with Save in the header.
   *Layout revision:* the grid now defaults back to weekdays-as-columns in a
   calendar-style layout sized so every shown day fits without sideways
   scrolling, and the grid shows one dated week at a time (swipe or the
   header arrows to change week). The weekdays-as-rows layout above is kept
   as a "Timetable layout" setting; because its own horizontal scroll owns
   sideways gestures, it changes week with the header arrows rather than by
   swiping.
   *Gesture pass:* the vertical layout is now a single Reanimated/Gesture
   Handler surface — week paging, vertical scrolling, pinch zoom of the time
   scale, and long-press move/resize of blocks, all axis-locked and driven
   on the UI thread. Placements gained a `slotSpan` so a class can occupy
   consecutive periods; placement remains period-aligned by design (no
   arbitrary-minute events).

7. **Quick class creation**
   Tapping an empty slot lets the user create a class with just a name,
   per the minimal flow in [PRODUCT.md](PRODUCT.md), defaulting to weekly
   recurrence until term end.
   *Done when:* a class created this way appears in its slot, persists
   across restarts, and optional fields (room, teacher, notes) can be added
   during creation.
   *Status: in progress.* Implemented in memory, including optional
   fields; does not yet persist across restarts (see milestone 5).

8. **Editing and deletion**
   Existing placements can be edited (including optional fields) and
   deleted.
   *Done when:* a user can change or remove any field of an existing
   placement and the change persists.
   *Status: in progress.* Editing and deletion are implemented in memory;
   changes do not yet persist across restarts (see milestone 5).

9. **Reusable courses**
   Courses become entities independent of a single placement, reusable
   across multiple slots without re-entering their details.
   *Done when:* creating a second placement for an existing course (e.g.
   another "Mathematics" slot) does not require re-entering the course's
   name/room/teacher from scratch.

10. **Recurrence**
    Recurrence settings become editable beyond the "weekly until term end"
    default, including custom end dates and single-occurrence exceptions.
    *Done when:* a user can change a placement's recurrence and separately
    edit or cancel one occurrence without affecting the recurring rule.

11. **Settings**
    A settings screen exposes week configuration and academic-day defaults
    for changes after initial onboarding.
    *Done when:* changing a setting (e.g. default lesson duration) affects
    future slot generation without silently altering existing placements.

12. **Backup and restore**
    Users can export their timetable data to a file and re-import it.
    *Done when:* a backup file produced by export fully reconstructs the
    timetable state when imported on the same or another device.

13. **Calendar export**
    Timetable data can be exported in a format consumable by external
    calendar applications (e.g. Google Calendar, Apple Calendar, Samsung
    Calendar).
    *Done when:* an exported file, imported into at least one target
    calendar app, shows correctly recurring events.

14. **Later synchronization and desktop work**
    Cross-device synchronization, optional accounts, and a desktop-oriented
    web experience.
    *Done when:* scoped in detail at the time this milestone is actually
    started — deliberately not defined further now (see "Intentionally
    deferred decisions" in [ARCHITECTURE.md](ARCHITECTURE.md)).
