# Temelo Beta 1

Version 0.1.0 — the first build of Temelo that installs and runs on its own,
with no development machine and no network connection.

Temelo is a local-first timetable app for school and university students. You
describe the academic day once — when it starts, how long a lesson and a break
are, how many periods there are — and from then on adding a class is a tap on
an empty slot, a name, and save.

## Highlights

**Timetable**

- A weekly grid of one dated week at a time, in a vertical layout (days across,
  periods down) or a horizontal one, whichever you prefer.
- Swipe between weeks, pinch to zoom the time scale, long-press to move or
  resize a class. A class can span consecutive periods.

**Classes and recurrence**

- Add a class in three taps. Room, teacher, notes, colour and reminder are
  optional and can be filled in later.
- Weekly, every-two-weeks, or one-time. A repeating class is open-ended: it
  runs until you change or delete it, not until a date you had to guess.
- Editing a repeating class asks what the change applies to — this occurrence,
  this and every later one, or the whole series — so moving one week's lesson
  does not move the rest of the term.
- Two alternating biweekly classes can share the same weekday and period
  without being treated as a clash.

**Timetables**

- One timetable in use at a time, and any number of archived ones. Archiving
  keeps every class and is undone by Restore; nothing is deleted unless you
  delete it.
- A timetable has a start date and no end date. Moving the start date earlier
  extends repeating classes back into those weeks and deletes nothing.

**Reminders**

- A local notification a chosen number of minutes before a class, with a
  default for new classes and a per-class override.
- Silent, with one short vibration, on a notification channel you can adjust in
  Android's own settings.

**Backup and transfer**

- Share any timetable as a `.temelo` file through the Android share sheet — by
  message, mail, Drive or Quick Share, or simply kept as a backup.
- Import one back: pick the file, read a preview of what is in it, confirm.
  Nothing is written until you do. You can also share a `.temelo` to Temelo
  from another app.
- An import is always a fresh local copy, so importing your own backup while
  the original is still on the device is safe.

**Calendar export**

- Export a date range to a standard `.ics` file that Google Calendar, Samsung
  Calendar, Apple Calendar and anything else standards-compliant can read.
  Moved lessons go out at their new date, cancelled ones are left out.

**Appearance and language**

- Light, dark, or follow the system.
- English, Russian and German, following the device's languages by default.

## Beta limitations

These are deliberate for Beta 1, not defects:

- **Android only.** Temelo is developed and tested on Android. There is no iOS
  or web release.
- **Not on Google Play.** This is a test build installed from a file. Android
  will ask you to allow installation from your browser or files app.
- **No accounts and no cloud sync.** Everything lives on the device, which is
  also why no account is needed and why the app works with no network at all.
- **Calendar export is one-way.** Temelo writes `.ics` files; it never reads a
  calendar, and an exported file does not update when the timetable changes.
  Export again to refresh it.
- **Your data is on this device only.** There is no backup behind the scenes.
  If you are going to care about a timetable, share it as a `.temelo` file and
  keep the file somewhere.
- **Uninstalling removes everything.** Export first.

## Known gaps

Planned, not in this build:

- Picking an existing course when creating a second placement of it.
- Opening a `.temelo` with "Open with" from a file manager. Sharing one **to**
  Temelo is the reliable route, because most Android apps hand a `.temelo` over
  as an unrecognised file type.
- Editing an individual period's time after the academic day has generated the
  periods. Changing the academic day regenerates them, which clears the
  timetable, and the app asks before it does.

## Installing

1. Download `Temelo-Beta-1.apk` from this release.
2. Open it. Android will ask whether to allow installs from the app you
   downloaded it with — allow it for that app, then continue.
3. If you already have an earlier Temelo build installed, this one upgrades it
   and your timetables are kept.

## Feedback

Issues and suggestions: https://github.com/ZhanibekAkhmetov/Temelo/issues
