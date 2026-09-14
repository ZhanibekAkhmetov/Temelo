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

14. **Later synchronization and desktop work**
    Cross-device synchronization, optional accounts, and a desktop-oriented
    web experience.
    *Done when:* scoped in detail at the time this milestone is actually
    started — deliberately not defined further now (see "Intentionally
    deferred decisions" in [ARCHITECTURE.md](ARCHITECTURE.md)).

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

## Next milestone

Stabilization and a standalone, offline Android build (`preview` profile in
[eas.json](../eas.json)) that a tester can install without a development
machine. Milestone 13 was the last new feature planned for Beta 1, so what
remains before release is verification rather than construction — in
particular, the share-sheet and calendar-import behaviour that only a real
device can show, since the emulator cannot complete a calendar import without
signing a Google account into it.

Milestone 14 — synchronization, optional accounts and desktop work — stays
deliberately unscoped until it is actually started.
