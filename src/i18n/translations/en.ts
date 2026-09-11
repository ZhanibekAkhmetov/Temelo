/**
 * English — the source language.
 *
 * This object *is* the key list: `TranslationKey` is derived from it, and the
 * other dictionaries are typed as a complete record of those keys, so a key
 * added here that is not translated everywhere is a compile error rather than
 * an English string appearing in a Russian build.
 *
 * Keys are flat and dotted rather than nested. A flat map gives exact literal
 * key types with no traversal, and reads at the call site the way the brief
 * asks for: `t("classEditor.room")`.
 *
 * Placeholders are `{name}`. Anything a placeholder stands for is passed in
 * at the call site; nothing here is built by concatenating fragments, because
 * word order is exactly what a translation is allowed to change.
 */

export const en = {
  // ---------------------------------------------------------------- common
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.delete": "Delete",
  "common.close": "Close",
  "common.done": "Done",
  "common.back": "Back",
  "common.continue": "Continue",
  "common.finish": "Finish",
  "common.none": "None",
  "common.custom": "Custom",
  "common.optional": "Optional",
  "common.saved": "Saved.",
  "common.system": "System",
  "common.hoursUnit": "h",
  "common.minutesUnit": "min",

  /** A length of time, as a field's value: "45 min", "1 h", "1 h 30 min". */
  "duration.minutes": "{minutes} min",
  "duration.hours": "{hours} h",
  "duration.hoursMinutes": "{hours} h {minutes} min",

  // ------------------------------------------------------------- timetable
  "timetable.today": "Today",
  "timetable.previousWeek": "Previous week",
  "timetable.nextWeek": "Next week",
  "timetable.goToCurrentWeek": "Go to current week",
  "timetable.openSettings": "Open settings",
  "timetable.cannotMove": "Cannot move class",
  "timetable.cannotApply": "Cannot apply change",
  "timetable.newRangeHint": "New class position, tap again to set it up",
  "timetable.rangeInUse": "in use",
  "timetable.classAt": "{name}, {weekday}, period {period}",
  "timetable.classAtTime": "{name}, {weekday}, period {period}, {start} to {end}",
  "timetable.emptySlotAtTime": "Empty slot, {weekday}, period {period}, {start} to {end}",
  "timetable.beforeStartTitle": "Before this timetable starts",
  "timetable.beforeStartMessage":
    "{name} starts on {date}. To add classes earlier, change its start date in Timetables.",

  // ----------------------------------------------------------- classEditor
  "classEditor.newTitle": "New class",
  "classEditor.editTitle": "Edit class",
  "classEditor.name": "Class name",
  "classEditor.namePlaceholder": "e.g. Mathematics",
  "classEditor.room": "Room",
  "classEditor.teacher": "Teacher",
  "classEditor.notes": "Notes",
  "classEditor.reminder": "Reminder",
  "classEditor.remindersBlocked": "Reminders are off until notification permission is granted.",
  "classEditor.useAsDefaultReminder": "Use as default for new classes",
  "classEditor.currentDefaultReminder": "New classes currently start at {value}.",
  "classEditor.moreDetails": "More details",
  "classEditor.hideDetails": "Hide details",
  "classEditor.showMoreDetails": "Show more details",
  "classEditor.hideMoreDetails": "Hide more details",
  "classEditor.slot": "{weekday} · period {period} · {start}–{end}",
  "classEditor.slotSpan": "{weekday} · periods {from}–{to} · {start}–{end}",
  "classEditor.recurrence": "Recurrence",
  "classEditor.date": "Date",
  "classEditor.startDate": "Start date",
  "classEditor.biweeklyStartHint": "Sets which alternating week this class falls on",
  "classEditor.deleteClass": "Delete class",
  "classEditor.deleteTitle": "Delete class?",
  "classEditor.deleteMessage": "Remove {name} from the timetable. This cannot be undone.",
  "classEditor.summaryOnce": "One time on {date}",
  "classEditor.summaryWeekly": "Repeats every week",
  "classEditor.summaryBiweekly": "Repeats every two weeks",

  // ------------------------------------------------------------ classColor
  "classColor.label": "Color",
  "classColor.picker": "Class colour",
  "classColor.blue": "Blue",
  "classColor.orange": "Orange",
  "classColor.green": "Green",
  "classColor.purple": "Purple",
  "classColor.amber": "Amber",
  "classColor.teal": "Teal",
  "classColor.magenta": "Magenta",
  "classColor.deepGreen": "Forest green",
  "classColor.indigo": "Indigo",
  "classColor.red": "Red",
  "classColor.cyan": "Cyan",
  "classColor.graphite": "Graphite",

  // ------------------------------------------------------------ recurrence
  "recurrence.label": "Recurrence",
  "recurrence.weekly": "Weekly",
  "recurrence.biweekly": "Every 2 weeks",
  "recurrence.once": "One time",

  // ---------------------------------------------------------- scopeChooser
  "scopeChooser.title": "Apply changes to",
  "scopeChooser.onlyThis": "Only this occurrence",
  "scopeChooser.thisAndFuture": "This and future occurrences",
  "scopeChooser.all": "All occurrences",
  "scopeChooser.onlyThisHint": "Changes {date} only; the rest of the series stays as it is.",
  "scopeChooser.thisAndFutureHint": "Splits the series here — earlier occurrences keep their current details.",
  "scopeChooser.allHint": "Updates every occurrence of this class, past and future.",

  // ------------------------------------------------------------- reminders
  "reminders.title": "Reminders",
  "reminders.defaultForNewClasses": "Default for new classes",
  "reminders.existingKeepTheirOwn": "Classes that already exist keep their own reminder.",
  "reminders.permissionDenied":
    "Reminders are disabled until notification permission is granted in system settings. Classes still save normally.",
  "reminders.customMinimum": "A custom reminder must be at least {minutes} min before.",
  "reminders.hoursBefore": "Hours before",
  "reminders.minutesBefore": "Minutes before",
  /** A lead time as a value: "30 min before", "1 hour before". */
  "reminders.before": "{lead} before",
  /** The lead time itself, in the sentence form a notification reads best in. */
  "reminders.leadMinutes": "{minutes} min",
  "reminders.leadHoursOne": "1 hour",
  "reminders.leadHoursOther": "{hours} hours",
  "reminders.leadHoursAndMinutes": "{hours} {minutes} min",
  "reminders.notificationStartsIn": "Starts in {lead}",
  "reminders.notificationRoom": "Room {room}",
  "reminders.channelName": "Class reminders",
  "reminders.channelDescription": "Silent reminders with a short vibration before a class starts.",

  // -------------------------------------------------------------- settings
  "settings.title": "Settings",
  "settings.appearance": "Appearance",
  "settings.appearanceSystem": "System",
  "settings.appearanceLight": "Light",
  "settings.appearanceDark": "Dark",
  "settings.language": "Language",
  "settings.languageSystem": "System",
  "settings.chooseLanguage": "Choose language",
  "settings.sectionGeneral": "General",
  "settings.sectionTimetable": "Timetable",
  "settings.layout": "Layout",
  "settings.layoutVertical": "Vertical",
  "settings.layoutHorizontal": "Horizontal",
  "settings.layoutHint": "Vertical puts the days across the top; horizontal puts them down the side.",
  "settings.daysWithoutClasses": "Days without classes",
  "settings.timetables": "Timetables",
  "settings.currentTimetable": "Current timetable",
  "settings.noTimetable": "None",
  "settings.academicDay": "Academic day",
  /**
   * The academic day as one line: the hours it actually covers.
   *
   * The span rather than a count of periods, because "{count} periods" needs a
   * plural rule in every language it is translated into — and Russian needs
   * three of them — to avoid writing "1 periods" the one time somebody sets a
   * single-period day. The span says more and inflects nothing.
   */
  "settings.academicDaySummary": "{start}–{end}",
  "settings.reset": "Delete all data",
  "settings.resetTitle": "Delete all data?",
  "settings.resetMessage":
    "This removes every class, every timetable including archived ones, and all settings, then starts setup again. This cannot be undone.",
  "settings.resetConfirm": "Delete",
  "settings.developer": "Developer",
  "settings.loadSample": "Load sample timetable",
  "settings.loadSampleTitle": "Load sample timetable?",
  "settings.loadSampleMessage":
    "Development only. This replaces the current timetable's periods and classes with placeholder classes for testing gestures.",
  "settings.loadSampleConfirm": "Load",

  // ------------------------------------------------------------------ week
  "week.weekend": "Weekend",
  "week.weekendSaturdaySunday": "Sat & Sun",
  "week.weekendSundayOnly": "Sun only",
  "week.weekendNone": "Show all",

  // ------------------------------------------------------------ onboarding
  "onboarding.weekTitle": "Week layout",
  "onboarding.weekSubtitle": "Choose which days have no classes.",
  "onboarding.academicDayTitle": "Academic day",
  "onboarding.academicDaySubtitle": "A typical day. The periods below are generated from it.",
  "onboarding.dayStart": "Day starts at",
  "onboarding.dayStartHint": "24-hour, in five-minute steps",
  "onboarding.lessonDuration": "Lesson duration",
  "onboarding.breakDuration": "Break between lessons",
  "onboarding.slotCount": "Periods per day",
  "onboarding.preview": "Preview",
  "onboarding.regenerateTitle": "Regenerate time slots?",
  "onboarding.regenerateMessage":
    "Changing these settings will regenerate time slots and remove existing classes from the timetable. This cannot be undone.",
  "onboarding.timetableName": "Timetable name",
  "onboarding.timetableNamePlaceholder": "My timetable",

  // ------------------------------------------------------------ datePicker
  "datePicker.previousMonth": "Previous month",
  "datePicker.nextMonth": "Next month",

  // -------------------------------------------------------- durationPicker
  "durationPicker.hours": "Hours",
  "durationPicker.minutes": "Minutes",
  "durationPicker.hour": "Hour",
  "durationPicker.minute": "Minute",
  "durationPicker.minimum": "Must be at least {value}.",

  // -------------------------------------------------------------- timetables
  "timetables.title": "Timetables",
  "timetables.sectionCurrent": "Current timetable",
  "timetables.sectionArchived": "Archived timetables",
  "timetables.sectionArchivedCount": "Archived timetables ({count})",
  "timetables.archivedEmpty": "Timetables you archive will be kept here.",
  "timetables.createNew": "Create new timetable",
  "timetables.noCurrent": "No timetable yet",
  "timetables.noCurrentHint": "Create one to start adding classes.",
  "timetables.detailsTitle": "Timetable",
  "timetables.name": "Name",
  "timetables.academicDay": "Academic day",
  "timetables.days": "Days shown",
  "timetables.startsOn": "Starts on",
  "timetables.startDateTitle": "Timetable start",
  "timetables.startDateNote":
    "Classes before this date won't appear. Moving it earlier brings repeating classes into those weeks. Nothing is deleted.",
  "timetables.defaultName": "Timetable",
  "timetables.nameOptionalHint": "Optional. Leave it blank and Temelo will name it for you.",
  "timetables.currentBadge": "Current",
  "timetables.archivedOn": "Archived {date}",
  "timetables.summary": "{days} · {hours}",
  "timetables.daysRange": "{first}–{last}",
  "timetables.rename": "Rename timetable",
  "timetables.renamePrompt": "Timetable name",
  "timetables.archiveAction": "Archive timetable",
  "timetables.archiveTitle": "Archive {name}?",
  "timetables.archiveMessage":
    "Your classes are kept. It moves to Archived and can be restored later. Its reminders stop while it is archived.",
  "timetables.archiveConfirm": "Archive",
  "timetables.restoreAction": "Restore timetable",
  "timetables.restoreTitle": "Restore {name}?",
  "timetables.restoreMessage": "Your current timetable “{current}” will be archived.\nNothing will be deleted.",
  "timetables.restoreConfirm": "Restore",
  "timetables.deleteAction": "Delete permanently",
  "timetables.deleteTitle": "Delete “{name}”?",
  "timetables.deleteMessage":
    "This timetable and its classes will be permanently removed from this device. This cannot be undone.",
  "timetables.deleteConfirm": "Delete",
  "timetables.damaged": "This archived timetable cannot be read and cannot be restored.",
  "timetables.createTitle": "New timetable",
  "timetables.createSubtitle": "Name it, choose when it starts and which days have classes.",
  "timetables.createReplaceNotice":
    "{name} will be archived when this timetable is created — not before. Nothing is deleted.",
  "timetables.createFinish": "Create timetable",
  "timetables.createConfirmTitle": "Create new timetable?",
  "timetables.createConfirmMessage": "Your current timetable “{current}” will be archived.\nNothing will be deleted.",
  "timetables.createConfirm": "Create",

  // ---------------------------------------------------------------- errors
  "errors.slotInUse": "This slot is already used by {name}.",
  "errors.classNameRequired": "Class name is required.",
  "errors.timetableNameRequired": "Timetable name is required.",
  "errors.noActiveTimetable": "There is no active timetable.",
  "errors.archiveGone": "This archived timetable no longer exists.",
  "errors.archiveUnreadable": "This archived timetable is damaged and cannot be restored.",
  "errors.classGone": "This class no longer exists.",
  "errors.beforeTimetableStart": "This date is before the timetable starts.",
  "errors.startDateInvalid": "Start date must be a valid date (DD.MM.YYYY).",
  "errors.endDateInvalid": "End date must be a valid date (DD.MM.YYYY).",
  "errors.dateInvalid": "Enter a valid date as DD.MM.YYYY.",
  "errors.endBeforeStart": "End date cannot be before the start date.",
  "errors.endBeforeOccurrence": "End date cannot be before this occurrence.",
  "errors.recurrenceWholeSeries": "Recurrence changes apply to the whole series.",
  "errors.storageWriteFailed": "Could not save to this device. Your changes are only in memory and will be lost when the app closes.",
  "errors.dayStartInvalid": "Academic day start must be a valid time (HH:mm).",
  "errors.lessonDurationInvalid": "Lesson duration must be a positive number of minutes.",
  "errors.breakDurationInvalid": "Break duration must be zero or a positive number of minutes.",
  "errors.slotCountInvalid": "Number of periods must be a positive whole number.",
  "errors.slotCountTooMany": "Number of periods must be {max} or fewer.",
  "errors.periodPastMidnight":
    "Period {position} would end after midnight. Reduce the number of periods, lesson duration, or start time.",
} as const;

export type TranslationKey = keyof typeof en;

/**
 * A complete dictionary. Every other language is typed as this, so a key
 * added to `en` fails to compile until `ru` and `de` have answered it.
 */
export type Translations = Record<TranslationKey, string>;
