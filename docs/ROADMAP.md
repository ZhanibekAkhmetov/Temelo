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
   [PRODUCT.md](PRODUCT.md) as it then stood — the term step was later removed
   from the product entirely (see milestone 15).
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
   shows the same timetable, periods, and settings without re-running setup.
   *Status: done.* SQLite (`expo-sqlite`) behind `src/storage/`, with
   versioned migrations, WAL and foreign keys on, hydration gated before
   first render, and every successful `AppState` mutation written back as a
   transactional diff. See "Local persistence" in
   [ARCHITECTURE.md](ARCHITECTURE.md).
   The one-time legacy seed import that carried the original in-memory
   timetable onto the device has served its purpose and is gone; a
   never-initialized database now starts at onboarding. What remains is
   `src/state/sampleTimetable.ts`, invented placeholder classes offered only
   under `__DEV__` and only when asked for from Settings.

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
   per the minimal flow in [PRODUCT.md](PRODUCT.md), defaulting to
   open-ended weekly recurrence.
   *Done when:* a class created this way appears in its slot, persists
   across restarts, and optional fields (room, teacher, notes) can be added
   during creation.
   *Status: done.* Including optional fields, a per-class colour and a
   reminder lead time; persisted through `src/storage/` (milestone 5).

8. **Editing and deletion**
   Existing placements can be edited (including optional fields) and
   deleted.
   *Done when:* a user can change or remove any field of an existing
   placement and the change persists.
   *Status: done.* Editing (from the editor and from move/resize gestures)
   and deletion both persist. Edits to a repeating class go through the
   scope chooser described in milestone 10.

9. **Reusable courses**
   Courses become entities independent of a single placement, reusable
   across multiple slots without re-entering their details.
   *Done when:* creating a second placement for an existing course (e.g.
   another "Mathematics" slot) does not require re-entering the course's
   name/room/teacher from scratch.
   *Status: not started.* Courses are already separate records that
   placements and exceptions point at, but nothing in the UI offers an
   existing course — each new class still creates its own.

10. **Recurrence**
    Recurrence settings become editable beyond the plain weekly default,
    including single-occurrence exceptions.
    *Done when:* a user can change a placement's recurrence and separately
    edit or cancel one occurrence without affecting the recurring rule.
    *Status: done.* Weekly, every-two-weeks and one-time recurrence; every
    edit to a repeating class asks its scope (only this occurrence / this and
    future / all), implemented as per-occurrence exceptions and series
    splitting. Clash checking resolves recurrence onto concrete dates, so
    alternating classes can share a period. A repeating series is now
    open-ended rather than bounded by a term end (milestone 15); the only end
    date a series can have is the one a "this and future" split gives it.

11. **Settings**
    A settings screen exposes week configuration and academic-day defaults
    for changes after initial onboarding.
    *Done when:* changing a setting (e.g. default lesson duration) affects
    future slot generation without silently altering existing placements.
    *Status: mostly done.* Settings covers appearance, language, timetable
    layout, the default reminder, a full reset, and one row into timetable
    management. The timetable's own properties — its name, the days it shows
    and its academic day — moved to the timetable's own screen in milestone
    15, so there is a single owner for each. Two gaps remain: changing the
    academic day regenerates the periods and clears the existing classes —
    announced by a confirmation rather than done silently, but still
    destructive — and an individual period's time cannot yet be edited on its
    own, which [PRODUCT.md](PRODUCT.md) requires.

12. **Backup and restore**
    Users can export their timetable data to a file and re-import it.
    *Done when:* a backup file produced by export fully reconstructs the
    timetable state when imported on the same or another device.
    *Status: done.* Any timetable — the active one or an archived one — exports
    to a `.temelo` file (UTF-8 JSON: a versioned envelope around the
    `TimetableSnapshot` milestone 15 built) and is handed to the Android share
    sheet, so the same action covers keeping a backup and sending a timetable to
    a friend. Import is started inside Temelo with the system document picker,
    validates the file completely before anything is written, and shows a
    preview the user has to confirm; a malformed, foreign or newer-format file
    produces a normal error and zero database changes. Every import creates a
    *new local copy* with fresh device-generated ids, so importing your own
    backup beside the original, or the same file twice, is safe and cannot
    inherit a scheduled reminder's identity. With a timetable active the import
    joins the archived ones and the current timetable is untouched; with none it
    becomes the active timetable. Reminder lead times travel; the reminder
    ledger, OS notification identifiers and every app-global preference do not.
    Sharing a timetable is also offered by a long press on any row of the
    Timetables screen.

    A `.temelo` can also arrive the other way: **Share → Temelo** from Telegram,
    WhatsApp, mail or Drive. That is deliberately *not* a visit to the app — it
    is a transient receiver drawn over whatever is on screen, with the same
    preview, the same validator and the same import, then "Timetable imported"
    and Done, which returns the user to the app they shared from. It performs no
    navigation at all, which is the whole of why it is reliable; the imported
    timetable is seen by opening Temelo normally. Repeated imports of the same
    name are numbered ("SoSe26 (1)"), and the preview shows the final name
    before the user agrees to it. See "Receiving a share" in
    [ARCHITECTURE.md](ARCHITECTURE.md).

    Not covered here: Android's "Open with Temelo" intent for a `.temelo` the
    user *taps* outside the app, which stays best-effort at the mercy of
    whichever content provider reports the file's type.

13. **Calendar export** *(Beta 1)*
    Timetable data can be exported in a format consumable by external
    calendar applications (e.g. Google Calendar, Apple Calendar, Samsung
    Calendar).
    *Done when:* an exported file, imported into at least one target
    calendar app, shows correctly recurring events.
    *Status: implemented; the acceptance check above is pending on a real
    device.* Sharing became
    a choice — **Share Temelo file** or **Export to calendar** — on the current
    timetable's screen, an archived one's, and the long press on the Timetables
    list. Calendar export is **one way**: an `.ics` for a date range the user
    picks, handed to the share sheet. There is no `.ics` import, no
    synchronization, no Calendar Provider or EventKit integration and no
    calendar permission.
    Because a timetable has no end date the export is bounded — at most 366
    days, suggested as six months from today, or from an archive's own start
    date. Within that range every occurrence is written as its own `VEVENT`
    rather than as an `RRULE`, which is what keeps moved, cancelled and split
    occurrences exactly right: the events come from `resolveOccurrences`, the
    same resolver the grid draws from, so the calendar cannot disagree with
    what the app shows. Times are RFC 5545 *floating* local date-times, because
    Temelo stores no timezone and inventing one would be a claim it cannot
    make. Archived timetables export from their stored snapshot without being
    restored, and nothing is written to the database to export anything.
    See "Calendar export" in [ARCHITECTURE.md](ARCHITECTURE.md).

14. **Web version and share links** *(first part of synchronization and
    desktop work)*
    Temelo runs in a desktop browser as the same Expo app, and a timetable
    can be shared as a link through a small optional web service. The app
    still needs no account and no network: everything below is additive, and
    the phone app works exactly as before without the service.
    *Done when:* a timetable made on the phone can be opened in a browser —
    by `.temelo` file or by link — previewed, imported and edited there, and
    survives a reload.

    Steps, in order. Each is one reviewable change, ends with
    `npm run lint` and `npm run harness` green, and is started by asking for
    it by number:

    - **14.1 Web build.** `metro.config.js` for `expo-sqlite` on web (wasm
      asset, COOP/COEP headers); `.web.ts` variants of `util/timetableFiles`
      (download, file picker, Web Share API), `util/notifications` and
      `util/haptics` (no-ops; reminders are stated as phone-only); the share
      receiver stays native-only; WAL tolerated where the web VFS refuses it;
      one active tab at a time; `navigator.storage.persist()`.
      *Done when:* in a desktop browser a timetable can be created, edited,
      exported and imported as `.temelo`, and is still there after a reload.
      No new npm dependency.
      *Status: done.* `util/timetableFiles`, `util/notifications`,
      `util/haptics` and the new `util/storageClaim` each have a `.web.ts`
      twin typed against the native file, and `harness/architecture.mjs`
      checks they export the same names. Export downloads (the share sheet on
      touch devices), import uses the browser's file chooser, reminders read
      as `"unavailable"` and say where they work. A second tab is refused with
      a notice rather than left to run in memory. WAL needed no special
      handling: the pragma does not fail on the web database. Verified in
      headless Chrome against both the dev server and the static export.
    - **14.2 Desktop layout.** A wide-screen layout that shows the whole week,
      and grid manipulation that works with mouse and trackpad.
      *Done when:* every phone interaction has a desktop equivalent.
      *Status: done.* From 1024 px (`useIsDesktop`, web only) the week sits
      under a toolbar (Today, week arrows, the month) beside a sidebar: a month
      to jump through, then one card each for the timetable, the view (days
      shown, layout), general settings (appearance, language) and reminders,
      with About at its foot. One-choice settings apply in the sidebar; the
      timetable screens, Settings, the class editor and every bottom sheet open
      as centred dialogs over the week; creating a timetable is a centred card.
      Blocks stop short of the next column and show their time range, and the
      day grows to fill the window. Dragging and resizing a class with a mouse
      (press, hold, drag) works as on a phone. Below 1024 px, and on every
      phone, nothing changed.
    - **14.3 TypeScript test runner.** Resolves the deferred "test runner"
      decision in [ARCHITECTURE.md](ARCHITECTURE.md). The domain suites move
      to it; `harness/` stays until everything it checks is covered.
      *Needs explicit approval of the dev dependency.*
    - **14.4 Server scaffold.** A Spring Boot project in `server/` (Java 21,
      Maven wrapper, Spring Web, Validation, Data JPA, PostgreSQL, Flyway,
      Testcontainers), PostgreSQL via Docker Compose, a health endpoint, and
      `mvnw test` green. Amends the "no backend" non-goal in
      [PRODUCT.md](PRODUCT.md) and adds the server commands to `CLAUDE.md`.
      The Expo app's dependencies are untouched.
    - **14.5 Share-link API.** `POST` a `.temelo` envelope, get back an id and
      an expiry; `GET` it by id. The server checks the envelope's version,
      shape and size before storing it; links expire; there are no accounts.
      Described with OpenAPI and covered by MockMvc and Testcontainers tests.
      The app still validates whatever it downloads with the same snapshot
      validator a restore uses — the server is never trusted.
    - **14.6 Share links in the app.** "Share link" beside "Share Temelo
      file" and "Export to calendar"; opening a link leads to the same import
      preview, and importing still clones every id. How a link reaches the
      native app is decided in this step.
    - **14.7 Hosting and documentation.** The static web build hosted with
      the COOP/COEP headers; the server runnable with one Docker Compose
      command; README and [ARCHITECTURE.md](ARCHITECTURE.md) describe both.

    *Deliberately out of scope:* accounts, cross-device synchronization and
    web reminders (they would need push and therefore a server-side
    schedule) — still unscoped, see "Intentionally deferred decisions" in
    [ARCHITECTURE.md](ARCHITECTURE.md).

15. **Timetable lifecycle** *(Beta 1)*
    The product's organising concept becomes one **active timetable** plus
    zero or more **archived timetables**, and the academic term — a required
    start date and an estimated end date — is removed from the model
    altogether.
    *Done when:* a user can create, archive, restore, rename and permanently
    delete timetables; a repeating class no longer stops because of a date
    they were once asked to guess; and an existing device's timetable survives
    the upgrade with its classes, biweekly parity, exceptions, colours and
    reminders intact.
    *Status: done.* Recurring series are open-ended (`OPEN_ENDED_DATE`) and
    still resolved lazily over the visible or reminder range; biweekly parity
    is anchored per series on its own `startsOn`, so removing the global
    start date changed no existing class. The active timetable stays in the
    normalised working tables; an archived one is a validated, versioned JSON
    snapshot, and every archive, restore and create-new is one atomic swap
    (`storage/timetableLifecycle`). Migration v6 promotes the existing term
    to the active timetable, keeps its name and uses its start date as the
    timetable's internal anchor, and opens the end date of every repeating
    series that ran to the term's estimated end — leaving a split series'
    deliberate end date alone. The legacy `terms` table is left in place
    rather than dropped; nothing reads it. Timetable management lives on its
    own screens behind a single Settings row.

## Work delivered outside the numbered milestones

Two pieces of work were never planned as milestones above, but are
implemented and are described in the README:

- **Class reminders** — a lead time per class plus a global default for new
  ones, delivered as local notifications. The next fortnight's reminders are
  planned from the stored timetable (`domain/reminderSchedule`) and reconciled
  against what the OS already holds (`features/reminders/scheduler`), with a
  persisted ledger so nothing is delivered twice across restarts.
- **Appearance and language** — a system/light/dark preference and an
  English/Russian/German UI, both stored as *preferences* rather than as the
  value they currently resolve to, so "System" keeps following the device.

## Current stage

Temelo **Beta 2** (version 0.2.0, `v0.2.0-beta.1`) is the latest Android
release; Beta 1 (0.1.0, `v0.1.0-beta.2`) completed the planned mobile
foundation — the timetable and recurrence model, SQLite persistence and
migrations, the timetable lifecycle, local reminders, `.temelo` backup and
import, one-way `.ics` export, localization, theming and branding — and Beta 2
added intentional overlaps, chosen start dates and any set of visible weekdays.

Milestone 14 is under way: the web version (14.1) and its desktop layout
(14.2) are done; it runs locally with `npm run web` and has not been hosted
yet (14.7).

## Next milestone

Step 14.3, the TypeScript test runner, then the Spring Boot share-link service
(14.4–14.6). Tester feedback on Beta 2 keeps priority over new work: high-impact
bugs are fixed first, preserving the data model and the upgrade path.
Synchronization, optional accounts and store distribution remain deliberately
unscoped until they are actually started.
