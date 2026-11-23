# Temelo Beta 2

Version 0.2.0. The second Android beta of Temelo, built from the feedback
on Beta 1. It adds three things testers asked for: classes that overlap on
purpose, repeating classes that start on a date you pick, and any set of
weekdays on the grid.

Temelo is a local-first timetable app for school and university students.
You describe your academic day once, and after that adding a class takes
three steps: tap an empty slot, type a name, save. Everything stays on your
phone, and the app works with no account and no internet connection.

## What's new

### Overlapping classes

Two classes can now share the same time slot when you need them to, for
example an optional seminar running at the same time as a lecture, or two
groups booked into one period.

- When a new or edited class would clash with another one, Temelo tells you
  which class is in the way and asks before saving. Choose **Save anyway**
  (or **Add anyway**) to keep both, or cancel to change nothing. Temelo never
  merges, replaces or removes a class because of an overlap.
- Overlapping classes are drawn side by side in the vertical layout and
  stacked in the cell in the horizontal layout. If more than two classes
  share a cell there, a **+N** badge shows how many more there are.
- Tap a shared slot to see every class at that time and open any one of
  them on its own. **Add another class at this time** in the class editor
  adds one to a slot that's already taken.
- Clashes are still checked on real dates, so two alternating every-two-weeks
  classes in the same slot still don't count as a conflict.

### Better conflict handling when moving and resizing

- When you drag or resize a class over another one, the grid marks it as
  overlapping while you hold it. Temelo asks you to confirm when you let go,
  and cancelling puts the class back where it was.
- A class dropped off the grid or before the timetable's start date goes back
  to where it came from.
- Edits that don't change when a class takes place, such as renaming it or
  changing its room, teacher, colour or reminder, don't ask about an overlap
  you've already accepted.

### Repeating classes that start on a chosen date

Weekly and every-two-weeks classes have a new **Starts** option in the class
editor:

- **With the timetable**: the default, and how every class behaved in
  Beta 1. The class runs from the timetable's start date.
- **On a chosen date**: the class begins on the date you pick. Nothing of it
  is shown, reminded about or exported to a calendar before its first lesson
  on or after that date. An every-two-weeks class counts its weeks from that
  first lesson.

A start date always applies to the whole series, so the "only this
occurrence" and "this and future occurrences" options are unavailable for
this change, and the editor explains why. Opening and saving a class without
touching **Starts** leaves its start exactly as it was.

### Any set of weekdays

A timetable can now show any combination of weekdays, not only the three
weekend presets Beta 1 had. Monday to Friday, Monday/Wednesday/Friday,
Tuesday to Saturday or the whole week all work.

- Choose the days when you create a timetable, or change them later under
  **Days shown** on the timetable's own screen. At least one day must stay
  visible.
- Hiding a day only hides it from the grid. Its classes stay stored, their
  reminders keep arriving, and calendar exports still include them. If the
  day you're hiding has classes, Temelo asks first.
- Show the day again and its classes are back exactly as they were.
- Timetable summaries name the days you chose, for example "Mon–Fri" or
  "Mon, Wed, Fri".

All three features work in both timetable layouts, vertical and horizontal.

## Updating from Beta 1

Install Beta 2 over Beta 1 and your timetables are kept. It's the same app,
signed with the same key, so Android updates it in place. Do not uninstall
Beta 1 first, because uninstalling deletes your data.

On first launch, Beta 2 upgrades its local database in one step:

- Each timetable keeps exactly the days it showed in Beta 1: Monday to
  Friday, Monday to Saturday, or the whole week.
- Existing classes keep starting with the timetable, and every-two-weeks
  classes stay on the same weeks.
- Archived timetables and `.temelo` files made with Beta 1 open in Beta 2.
  Files made with Beta 2 still use the same `.temelo` format, and Beta 1 can
  open them. Beta 1 shows only Monday to Friday, Monday to Saturday or the
  whole week, so it picks the smallest of those that includes every day you
  chose.

Make a `.temelo` backup before you update anyway. It's a good habit with any
beta.

## Everything from Beta 1 is still here

- **Offline and on your device.** All data is stored locally in the app. No
  account, no internet connection needed.
- **Recurring classes.** Weekly, every two weeks, or one time, with "only
  this", "this and future" and "all occurrences" edits.
- **Timetables.** One timetable in use plus any number of archived ones,
  restorable at any time.
- **Reminders.** A silent local notification a chosen number of minutes
  before a class.
- **Backup and transfer.** Share any timetable as a `.temelo` file and import
  it back with a preview before anything is written.
- **Calendar export.** A one-time `.ics` copy of a date range for Google
  Calendar, Samsung Calendar, Apple Calendar and others.
- **Appearance and language.** Light, dark or system theme. English, German
  and Russian.

## Beta limitations

- **Android only.** There is no iOS or web version.
- **Not on Google Play.** Beta 2 is a test build installed from an APK file,
  so Android asks you to allow installation from your browser or files app.
- **No accounts and no cloud sync.** Your timetables exist only on your
  phone. Back up anything you care about as a `.temelo` file.
- **Calendar export is one-way.** An exported `.ics` file doesn't update when
  the timetable changes. Export again to refresh it.
- **Uninstalling removes everything.** Export first.

Still planned and not in this build: picking an existing course when you add
a second placement of it, opening a `.temelo` from a file manager with "Open
with" (sharing it **to** Temelo works), and editing one period's time after
the periods have been generated.

## Installing

1. Download `Temelo-Beta-2.apk` from this release.
2. Open it. If Android asks, allow installs from the app you downloaded it
   with, then continue.
3. If Beta 1 is installed, Beta 2 updates it and keeps your timetables.

## Feedback

Issues and suggestions: https://github.com/ZhanibekAkhmetov/Temelo/issues
