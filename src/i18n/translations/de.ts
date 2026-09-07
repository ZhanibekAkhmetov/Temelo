/**
 * German.
 *
 * Written the way German app UI is actually written: short, address-free
 * (labels and infinitives — "Unterrichtsfreie Tage wählen", not "Wählen Sie
 * die Tage ohne Unterricht"), and using the established abbreviations —
 * "Std.", "Min.", "Mo.", "Raum" — instead of the long compounds a literal
 * translation would produce.
 *
 * Two vocabulary decisions worth stating:
 *
 *  - a timetable entry is a "Kurs" where it is the course itself and a
 *    "Termin" where it is one meeting of it — which is why the recurrence
 *    scopes say "Nur dieser Termin" and "Alle Termine". "Klasse" appears
 *    nowhere: in German it is a year group or a room, never a lesson.
 *  - the scope options are nominative and stand on their own, so the heading
 *    is "Änderungen übernehmen" rather than a "für" that leaves each option
 *    as a dangling accusative fragment.
 *
 * Length is a design constraint here, not an afterthought. German is the
 * longest of the three, and the controls it has to fit are audited for it:
 * the recurrence segments wrap to two lines rather than being truncated, and
 * the language chooser is a list precisely because "Systemeinstellung" would
 * not fit a four-way segmented control.
 */

import type { Translations } from "@/i18n/translations/en";

export const de: Translations = {
  "common.cancel": "Abbrechen",
  "common.save": "Speichern",
  "common.delete": "Löschen",
  "common.close": "Schließen",
  "common.back": "Zurück",
  "common.continue": "Weiter",
  "common.finish": "Fertig",
  "common.none": "Keine",
  "common.custom": "Eigene",
  "common.optional": "Optional",
  "common.saved": "Gespeichert.",
  "common.system": "System",
  "common.hoursUnit": "Std.",
  "common.minutesUnit": "Min.",

  "duration.minutes": "{minutes} Min.",
  "duration.hours": "{hours} Std.",
  "duration.hoursMinutes": "{hours} Std. {minutes} Min.",

  "timetable.today": "Heute",
  "timetable.previousWeek": "Vorherige Woche",
  "timetable.nextWeek": "Nächste Woche",
  "timetable.goToCurrentWeek": "Zur aktuellen Woche",
  "timetable.openSettings": "Einstellungen öffnen",
  "timetable.cannotMove": "Verschieben nicht möglich",
  "timetable.cannotApply": "Änderung nicht möglich",
  "timetable.newRangeHint": "Platz für neuen Kurs, nochmals tippen",
  "timetable.rangeInUse": "belegt",
  "timetable.classAt": "{name}, {weekday}, {period}. Stunde",
  "timetable.classAtTime": "{name}, {weekday}, {period}. Stunde, {start} bis {end}",
  "timetable.emptySlotAtTime": "Frei, {weekday}, {period}. Stunde, {start} bis {end}",

  "classEditor.newTitle": "Neuer Kurs",
  "classEditor.editTitle": "Kurs bearbeiten",
  "classEditor.name": "Kursname",
  "classEditor.namePlaceholder": "z. B. Mathematik",
  "classEditor.room": "Raum",
  "classEditor.teacher": "Lehrkraft",
  "classEditor.notes": "Notizen",
  "classEditor.reminder": "Erinnerung",
  "classEditor.remindersBlocked": "Erinnerungen sind aus, bis Mitteilungen erlaubt sind.",
  "classEditor.useAsDefaultReminder": "Als Standard für neue Kurse",
  "classEditor.currentDefaultReminder": "Neue Kurse starten derzeit mit „{value}“.",
  "classEditor.moreDetails": "Mehr Details",
  "classEditor.hideDetails": "Weniger",
  "classEditor.showMoreDetails": "Mehr Details anzeigen",
  "classEditor.hideMoreDetails": "Details ausblenden",
  "classEditor.slot": "{weekday} · {period}. Stunde · {start}–{end}",
  "classEditor.slotSpan": "{weekday} · {from}.–{to}. Stunde · {start}–{end}",
  "classEditor.recurrence": "Wiederholung",
  "classEditor.date": "Datum",
  "classEditor.startDate": "Beginn",
  "classEditor.endDate": "Ende",
  "classEditor.biweeklyStartHint": "Legt fest, in welcher der wechselnden Wochen der Kurs liegt",
  "classEditor.endDateHint": "Geschätzt — später änderbar",
  "classEditor.deleteClass": "Kurs löschen",
  "classEditor.deleteTitle": "Kurs löschen?",
  "classEditor.deleteMessage": "„{name}“ aus dem Stundenplan entfernen. Das lässt sich nicht rückgängig machen.",
  "classEditor.summaryOnce": "Einmalig am {date}",
  "classEditor.summaryWeekly": "Wöchentlich bis {date}",
  "classEditor.summaryBiweekly": "Alle zwei Wochen bis {date}",

  "classColor.label": "Farbe",
  "classColor.picker": "Kursfarbe",
  "classColor.blue": "Blau",
  "classColor.orange": "Orange",
  "classColor.green": "Grün",
  "classColor.purple": "Violett",
  "classColor.amber": "Bernstein",
  "classColor.teal": "Petrol",
  "classColor.magenta": "Magenta",
  "classColor.deepGreen": "Tannengrün",
  "classColor.indigo": "Indigo",
  "classColor.red": "Rot",
  "classColor.cyan": "Cyan",
  "classColor.graphite": "Graphit",

  "recurrence.label": "Wiederholung",
  "recurrence.weekly": "Wöchentlich",
  "recurrence.biweekly": "Alle 2 Wochen",
  "recurrence.once": "Einmalig",

  "scopeChooser.title": "Änderungen übernehmen",
  "scopeChooser.onlyThis": "Nur dieser Termin",
  "scopeChooser.thisAndFuture": "Dieser und folgende",
  "scopeChooser.all": "Alle Termine",
  "scopeChooser.onlyThisHint": "Ändert nur den {date} — die übrige Serie bleibt unverändert.",
  "scopeChooser.thisAndFutureHint": "Teilt die Serie hier: frühere Termine behalten ihre Angaben.",
  "scopeChooser.allHint": "Ändert alle Termine dieses Kurses, vergangene und künftige.",

  "reminders.title": "Erinnerungen",
  "reminders.defaultForNewClasses": "Standard für neue Kurse",
  "reminders.existingKeepTheirOwn": "Bestehende Kurse behalten ihre eigene Erinnerung.",
  "reminders.permissionDenied":
    "Erinnerungen sind deaktiviert, bis Mitteilungen in den Systemeinstellungen erlaubt sind. Kurse werden trotzdem gespeichert.",
  "reminders.customMinimum": "Eine eigene Erinnerung muss mindestens {minutes} Min. vorher liegen.",
  "reminders.hoursBefore": "Stunden vorher",
  "reminders.minutesBefore": "Minuten vorher",
  "reminders.before": "{lead} vorher",
  "reminders.leadMinutes": "{minutes} Min.",
  "reminders.leadHoursOne": "1 Std.",
  "reminders.leadHoursOther": "{hours} Std.",
  "reminders.leadHoursAndMinutes": "{hours} {minutes} Min.",
  "reminders.notificationStartsIn": "Beginnt in {lead}",
  "reminders.notificationRoom": "Raum {room}",
  "reminders.channelName": "Kurserinnerungen",
  "reminders.channelDescription": "Lautlose Erinnerungen mit kurzer Vibration vor Kursbeginn.",

  "settings.title": "Einstellungen",
  "settings.appearance": "Darstellung",
  "settings.appearanceSystem": "System",
  "settings.appearanceLight": "Hell",
  "settings.appearanceDark": "Dunkel",
  "settings.language": "Sprache",
  "settings.languageSystem": "System",
  "settings.chooseLanguage": "Sprache wählen",
  "settings.sectionGeneral": "Allgemein",
  "settings.sectionTimetable": "Stundenplan",
  "settings.layout": "Tage anzeigen",
  "settings.layoutVertical": "Oben",
  "settings.layoutHorizontal": "Seitlich",
  "settings.daysWithoutClasses": "Unterrichtsfreie Tage",
  "settings.term": "Semester",
  "settings.termName": "Name des Semesters",
  "settings.estimatedEndDate": "Voraussichtliches Ende",
  "settings.academicDay": "Unterrichtstag",
  "settings.academicDaySummary": "{start}–{end}",
  "settings.reset": "Alle Daten löschen",
  "settings.resetTitle": "Alle Daten löschen?",
  "settings.resetMessage":
    "Löscht jeden Kurs, das Semester und alle Einstellungen und startet die Einrichtung neu. Das lässt sich nicht rückgängig machen.",
  "settings.resetConfirm": "Löschen",
  "settings.developer": "Entwicklung",
  "settings.loadSample": "Beispielplan laden",
  "settings.loadSampleTitle": "Beispielplan laden?",
  "settings.loadSampleMessage":
    "Nur für die Entwicklung. Ersetzt Semester, Stunden und Kurse durch Beispielkurse zum Testen der Gesten.",
  "settings.loadSampleConfirm": "Laden",

  "week.weekend": "Wochenende",
  "week.weekendSaturdaySunday": "Sa & So",
  "week.weekendSundayOnly": "Nur So",
  "week.weekendNone": "Alle",

  "onboarding.weekTitle": "Wochenaufbau",
  "onboarding.weekSubtitle": "Unterrichtsfreie Tage wählen.",
  "onboarding.academicDayTitle": "Unterrichtstag",
  "onboarding.academicDaySubtitle": "Ein typischer Tag. Die Stunden unten entstehen daraus.",
  "onboarding.dayStart": "Tag beginnt um",
  "onboarding.dayStartHint": "24 Stunden, in Fünf-Minuten-Schritten",
  "onboarding.lessonDuration": "Dauer einer Stunde",
  "onboarding.breakDuration": "Pause zwischen den Stunden",
  "onboarding.slotCount": "Stunden pro Tag",
  "onboarding.preview": "Vorschau",
  "onboarding.regenerateTitle": "Stunden neu erzeugen?",
  "onboarding.regenerateMessage":
    "Die Stunden werden neu erzeugt und bestehende Kurse aus dem Stundenplan entfernt. Das lässt sich nicht rückgängig machen.",
  "onboarding.termTitle": "Semester",
  "onboarding.termSubtitle":
    "Semester des Stundenplans festlegen — das Enddatum ist nur geschätzt und später änderbar.",
  "onboarding.termNamePlaceholder": "Aktuelles Semester",
  "onboarding.termEndDateHint": "Geschätzt — später leicht änderbar",

  "datePicker.previousMonth": "Vorheriger Monat",
  "datePicker.nextMonth": "Nächster Monat",

  "durationPicker.hours": "Stunden",
  "durationPicker.minutes": "Minuten",
  "durationPicker.hour": "Stunde",
  "durationPicker.minute": "Minute",
  "durationPicker.minimum": "Mindestens {value}.",

  "errors.slotInUse": "Dieser Platz ist bereits von {name} belegt.",
  "errors.classNameRequired": "Bitte einen Kursnamen angeben.",
  "errors.termNameRequired": "Bitte einen Semesternamen angeben.",
  "errors.classGone": "Diesen Kurs gibt es nicht mehr.",
  "errors.startDateInvalid": "Bitte ein gültiges Startdatum angeben (TT.MM.JJJJ).",
  "errors.endDateInvalid": "Bitte ein gültiges Enddatum angeben (TT.MM.JJJJ).",
  "errors.estimatedEndDateInvalid": "Bitte ein gültiges voraussichtliches Enddatum angeben (TT.MM.JJJJ).",
  "errors.dateInvalid": "Bitte ein Datum als TT.MM.JJJJ angeben.",
  "errors.endBeforeStart": "Das Enddatum darf nicht vor dem Startdatum liegen.",
  "errors.estimatedEndBeforeStart": "Das voraussichtliche Ende darf nicht vor dem Beginn liegen.",
  "errors.estimatedEndBeforeTermStart": "Das voraussichtliche Ende darf nicht vor dem Semesterbeginn liegen.",
  "errors.endBeforeOccurrence": "Das Enddatum darf nicht vor diesem Termin liegen.",
  "errors.recurrenceWholeSeries": "Änderungen an der Wiederholung gelten für die ganze Serie.",
  "errors.storageWriteFailed": "Speichern auf diesem Gerät nicht möglich. Die Änderungen liegen nur im Speicher und gehen beim Schließen verloren.",
  "errors.dayStartInvalid": "Bitte eine gültige Startzeit angeben (HH:MM).",
  "errors.lessonDurationInvalid": "Die Dauer einer Stunde muss größer als null sein.",
  "errors.breakDurationInvalid": "Die Pause darf nicht negativ sein.",
  "errors.slotCountInvalid": "Die Anzahl der Stunden muss eine ganze Zahl größer als null sein.",
  "errors.slotCountTooMany": "Höchstens {max} Stunden möglich.",
  "errors.periodPastMidnight":
    "Stunde {position} würde nach Mitternacht enden. Anzahl, Dauer oder Startzeit der Stunden verringern.",
};
