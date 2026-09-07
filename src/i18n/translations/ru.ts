/**
 * Russian.
 *
 * Written as app UI rather than as a translation of English sentences:
 * imperative where English is imperative, no formal address, and the short
 * wording a Russian calendar app actually uses.
 *
 * Three conventions, all deliberate:
 *
 *  - "Занятие" is the word for a class throughout — never "класс", which is a
 *    room or a year group, and never "предмет", which is the subject rather
 *    than the meeting. It is also what a *period* is called: "пара" is
 *    university jargon for a double lesson and means nothing to a school
 *    student, and Temelo is for both.
 *  - Choices are written in the nominative and read as a list of answers
 *    ("Только это занятие", "Все занятия") rather than being grammatically
 *    chained to their heading. A heading and its options are separated on
 *    screen, and case agreement across that gap reads as a broken sentence
 *    rather than as a completed one.
 *  - Durations and lead times use the abbreviations Russian UI actually uses
 *    ("30 мин", "2 ч"). They sidestep the four-way plural agreement Russian
 *    would otherwise need for "час/часа/часов", and they are what a user
 *    expects to read in a compact field.
 */

import type { Translations } from "@/i18n/translations/en";

export const ru: Translations = {
  "common.cancel": "Отмена",
  "common.save": "Сохранить",
  "common.delete": "Удалить",
  "common.close": "Закрыть",
  "common.back": "Назад",
  "common.continue": "Далее",
  "common.finish": "Готово",
  "common.none": "Нет",
  "common.custom": "Своё",
  "common.optional": "Необязательно",
  "common.saved": "Сохранено.",
  "common.system": "Как в системе",
  "common.hoursUnit": "ч",
  "common.minutesUnit": "мин",

  "duration.minutes": "{minutes} мин",
  "duration.hours": "{hours} ч",
  "duration.hoursMinutes": "{hours} ч {minutes} мин",

  "timetable.today": "Сегодня",
  "timetable.previousWeek": "Предыдущая неделя",
  "timetable.nextWeek": "Следующая неделя",
  "timetable.goToCurrentWeek": "К текущей неделе",
  "timetable.openSettings": "Открыть настройки",
  "timetable.cannotMove": "Не удалось перенести",
  "timetable.cannotApply": "Не удалось применить",
  "timetable.newRangeHint": "Место для нового занятия, нажмите ещё раз",
  "timetable.rangeInUse": "занято",
  "timetable.classAt": "{name}, {weekday}, занятие {period}",
  "timetable.classAtTime": "{name}, {weekday}, занятие {period}, с {start} до {end}",
  "timetable.emptySlotAtTime": "Свободно, {weekday}, занятие {period}, с {start} до {end}",

  "classEditor.newTitle": "Новое занятие",
  "classEditor.editTitle": "Изменить занятие",
  "classEditor.name": "Название занятия",
  "classEditor.namePlaceholder": "например, Математика",
  "classEditor.room": "Аудитория",
  "classEditor.teacher": "Преподаватель",
  "classEditor.notes": "Заметки",
  "classEditor.reminder": "Напоминание",
  "classEditor.remindersBlocked": "Напоминания выключены, пока не разрешены уведомления.",
  "classEditor.useAsDefaultReminder": "По умолчанию для новых занятий",
  "classEditor.currentDefaultReminder": "Сейчас для новых занятий — {value}.",
  "classEditor.moreDetails": "Подробнее",
  "classEditor.hideDetails": "Свернуть",
  "classEditor.showMoreDetails": "Показать подробности",
  "classEditor.hideMoreDetails": "Скрыть подробности",
  "classEditor.slot": "{weekday} · занятие {period} · {start}–{end}",
  "classEditor.slotSpan": "{weekday} · занятия {from}–{to} · {start}–{end}",
  "classEditor.recurrence": "Повтор",
  "classEditor.date": "Дата",
  "classEditor.startDate": "Начало",
  "classEditor.endDate": "Окончание",
  "classEditor.biweeklyStartHint": "Задаёт, на какой из чередующихся недель проходит занятие",
  "classEditor.endDateHint": "Примерно — можно изменить позже",
  "classEditor.deleteClass": "Удалить занятие",
  "classEditor.deleteTitle": "Удалить занятие?",
  "classEditor.deleteMessage": "Убрать «{name}» из расписания. Это действие нельзя отменить.",
  "classEditor.summaryOnce": "Однократно, {date}",
  "classEditor.summaryWeekly": "Каждую неделю до {date}",
  "classEditor.summaryBiweekly": "Раз в две недели до {date}",

  "classColor.label": "Цвет",
  "classColor.picker": "Цвет занятия",
  "classColor.blue": "Синий",
  "classColor.orange": "Оранжевый",
  "classColor.green": "Зелёный",
  "classColor.purple": "Фиолетовый",
  "classColor.amber": "Янтарный",
  "classColor.teal": "Бирюзовый",
  "classColor.magenta": "Малиновый",
  "classColor.deepGreen": "Тёмно-зелёный",
  "classColor.indigo": "Индиго",
  "classColor.red": "Красный",
  "classColor.cyan": "Голубой",
  "classColor.graphite": "Графитовый",

  "recurrence.label": "Повтор",
  "recurrence.weekly": "Каждую неделю",
  "recurrence.biweekly": "Раз в две недели",
  "recurrence.once": "Однократно",

  "scopeChooser.title": "Применить изменения",
  "scopeChooser.onlyThis": "Только это занятие",
  "scopeChooser.thisAndFuture": "Это и последующие",
  "scopeChooser.all": "Все занятия",
  "scopeChooser.onlyThisHint": "Изменится только {date} — остальные занятия останутся прежними.",
  "scopeChooser.thisAndFutureHint": "Серия разделится здесь: прошедшие занятия останутся прежними.",
  "scopeChooser.allHint": "Изменятся все занятия этой серии — прошедшие и будущие.",

  "reminders.title": "Напоминания",
  "reminders.defaultForNewClasses": "По умолчанию для новых занятий",
  "reminders.existingKeepTheirOwn": "У существующих занятий останутся свои напоминания.",
  "reminders.permissionDenied":
    "Напоминания отключены, пока не разрешены уведомления в настройках системы. Занятия сохраняются как обычно.",
  "reminders.customMinimum": "Своё напоминание — не меньше чем за {minutes} мин.",
  "reminders.hoursBefore": "Часов до начала",
  "reminders.minutesBefore": "Минут до начала",
  "reminders.before": "за {lead}",
  "reminders.leadMinutes": "{minutes} мин",
  "reminders.leadHoursOne": "1 ч",
  "reminders.leadHoursOther": "{hours} ч",
  "reminders.leadHoursAndMinutes": "{hours} {minutes} мин",
  "reminders.notificationStartsIn": "Начало через {lead}",
  "reminders.notificationRoom": "Ауд. {room}",
  "reminders.channelName": "Напоминания о занятиях",
  "reminders.channelDescription": "Беззвучные напоминания с короткой вибрацией перед началом занятия.",

  "settings.title": "Настройки",
  "settings.appearance": "Тема",
  "settings.appearanceSystem": "Системная",
  "settings.appearanceLight": "Светлая",
  "settings.appearanceDark": "Тёмная",
  "settings.language": "Язык",
  "settings.languageSystem": "Как в системе",
  "settings.chooseLanguage": "Язык интерфейса",
  "settings.sectionGeneral": "Основное",
  "settings.sectionTimetable": "Расписание",
  "settings.layout": "Расположение дней",
  "settings.layoutVertical": "Сверху",
  "settings.layoutHorizontal": "Сбоку",
  "settings.daysWithoutClasses": "Дни без занятий",
  "settings.term": "Семестр",
  "settings.termName": "Название семестра",
  "settings.estimatedEndDate": "Примерное окончание",
  "settings.academicDay": "Учебный день",
  "settings.academicDaySummary": "{start}–{end}",
  "settings.reset": "Удалить все данные",
  "settings.resetTitle": "Удалить все данные?",
  "settings.resetMessage":
    "Будут удалены все занятия, семестр и настройки, после чего начнётся настройка заново. Это действие нельзя отменить.",
  "settings.resetConfirm": "Удалить",
  "settings.developer": "Для разработчика",
  "settings.loadSample": "Загрузить тестовое расписание",
  "settings.loadSampleTitle": "Загрузить тестовое расписание?",
  "settings.loadSampleMessage":
    "Только для разработки. Текущий семестр, учебный день и занятия будут заменены тестовыми — для проверки жестов.",
  "settings.loadSampleConfirm": "Загрузить",

  "week.weekend": "Выходные",
  "week.weekendSaturdaySunday": "Сб и вс",
  "week.weekendSundayOnly": "Только вс",
  "week.weekendNone": "Все дни",

  "onboarding.weekTitle": "Учебная неделя",
  "onboarding.weekSubtitle": "Выберите дни без занятий.",
  "onboarding.academicDayTitle": "Учебный день",
  "onboarding.academicDaySubtitle": "Обычный учебный день. По нему строятся занятия ниже.",
  "onboarding.dayStart": "День начинается в",
  "onboarding.dayStartHint": "24 часа, с шагом 5 минут",
  "onboarding.lessonDuration": "Длительность занятия",
  "onboarding.breakDuration": "Перерыв между занятиями",
  "onboarding.slotCount": "Занятий в день",
  "onboarding.preview": "Предпросмотр",
  "onboarding.regenerateTitle": "Перестроить учебный день?",
  "onboarding.regenerateMessage":
    "Сетка будет построена заново, а существующие занятия удалены из расписания. Это действие нельзя отменить.",
  "onboarding.termTitle": "Семестр",
  "onboarding.termSubtitle": "Укажите семестр, на который составлено расписание. Дату окончания можно изменить позже.",
  "onboarding.termNamePlaceholder": "Текущий семестр",
  "onboarding.termEndDateHint": "Примерно — легко изменить позже",

  "datePicker.previousMonth": "Предыдущий месяц",
  "datePicker.nextMonth": "Следующий месяц",

  "durationPicker.hours": "Часы",
  "durationPicker.minutes": "Минуты",
  "durationPicker.hour": "Час",
  "durationPicker.minute": "Минута",
  "durationPicker.minimum": "Не меньше чем {value}.",

  "errors.slotInUse": "Это время уже занято: {name}.",
  "errors.classNameRequired": "Укажите название занятия.",
  "errors.termNameRequired": "Укажите название семестра.",
  "errors.classGone": "Этого занятия больше нет.",
  "errors.startDateInvalid": "Укажите корректную дату начала (ДД.ММ.ГГГГ).",
  "errors.endDateInvalid": "Укажите корректную дату окончания (ДД.ММ.ГГГГ).",
  "errors.estimatedEndDateInvalid": "Укажите корректную примерную дату окончания (ДД.ММ.ГГГГ).",
  "errors.dateInvalid": "Укажите дату в формате ДД.ММ.ГГГГ.",
  "errors.endBeforeStart": "Дата окончания не может быть раньше даты начала.",
  "errors.estimatedEndBeforeStart": "Примерное окончание не может быть раньше начала.",
  "errors.estimatedEndBeforeTermStart": "Примерное окончание не может быть раньше начала семестра.",
  "errors.endBeforeOccurrence": "Дата окончания не может быть раньше этого занятия.",
  "errors.recurrenceWholeSeries": "Изменение повтора применяется ко всей серии.",
  "errors.storageWriteFailed": "Не удалось сохранить на устройстве. Изменения есть только в памяти и пропадут при закрытии приложения.",
  "errors.dayStartInvalid": "Укажите корректное время начала дня (ЧЧ:ММ).",
  "errors.lessonDurationInvalid": "Длительность занятия должна быть больше нуля.",
  "errors.breakDurationInvalid": "Перерыв не может быть отрицательным.",
  "errors.slotCountInvalid": "Количество занятий должно быть целым числом больше нуля.",
  "errors.slotCountTooMany": "Занятий в день — не больше {max}.",
  "errors.periodPastMidnight":
    "Занятие {position} закончится после полуночи. Уменьшите их количество или длительность либо сдвиньте начало дня.",
};
