import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { DateField } from "@/components/DateField";
import { DatePickerSheet } from "@/components/DatePickerSheet";
import { ReminderField } from "@/components/ReminderField";
import { SwitchRow } from "@/components/SwitchRow";
import { TextField } from "@/components/TextField";
import { nextClassColorId, type ClassColorId } from "@/domain/classColor";
import {
  classEditorSchedule,
  createPendingClassEdit,
  draftHasChanges,
  validateClassEditDraft,
  type PendingClassEdit,
} from "@/domain/classEdit";
import type { DomainError } from "@/domain/errors";
import type { ReminderMinutes } from "@/domain/reminder";
import type { Weekday } from "@/domain/week";
import type { ScheduledClass } from "@/domain/timetable";
import { ChoiceRowField } from "@/components/ChoiceRowField";
import { FormSection } from "@/components/FormSection";
import { ClassColorField } from "@/features/timetable/ClassColorField";
import { useReminderStatus } from "@/features/reminders/useReminderStatus";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppState } from "@/state/AppStateContext";
import { useTheme } from "@/theme/useTheme";
import type { RecurrenceType, TimeSlot, Timetable } from "@/types/models";

interface ClassEditorModalProps {
  visible: boolean;
  onClose: () => void;
  weekday: Weekday;
  /** Date of the tapped cell, in the week that was on screen. */
  date: string;
  timeSlot: TimeSlot;
  /** Periods the class occupies — set by resizing it in the grid. */
  slotSpan: number;
  /** End of the last period in the span. */
  endTime: string;
  timetable: Timetable;
  existing?: ScheduledClass;
  /**
   * Edits to a repeating class leave here as a draft rather than as a
   * change: the screen asks which occurrences they apply to first.
   */
  onRequestScope: (edit: PendingClassEdit) => void;
}

/**
 * Which picker is open — at most one at a time. The colour unfolds in place;
 * a one-off's date opens a sheet over the form.
 */
type OpenPicker = "date" | "color" | null;

/** Answers Android's Back before the editor does; true when it handled it. */
type BackInterceptor = (() => boolean) | null;

export function ClassEditorModal({
  visible,
  onClose,
  weekday,
  date,
  timeSlot,
  slotSpan,
  endTime,
  timetable,
  existing,
  onRequestScope,
}: ClassEditorModalProps) {
  /*
   * Back inside a native Modal arrives as `onRequestClose` and never as a
   * BackHandler event, so an open date sheet cannot hear it for itself. The
   * form registers what Back should close first, and only when nothing is
   * registered does Back close the editor.
   */
  const backInterceptor = useRef<BackInterceptor>(null);
  const setBackInterceptor = useCallback((handler: BackInterceptor) => {
    backInterceptor.current = handler;
  }, []);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={() => {
        if (backInterceptor.current?.()) return;
        onClose();
      }}
      presentationStyle={Platform.OS === "ios" ? "fullScreen" : undefined}
    >
      {visible ? (
        <ClassEditorForm
          key={`${weekday}-${date}-${timeSlot.id}-${existing?.occurrenceId ?? "new"}`}
          onBackInterceptorChange={setBackInterceptor}
          onClose={onClose}
          weekday={weekday}
          date={date}
          timeSlot={timeSlot}
          slotSpan={slotSpan}
          endTime={endTime}
          timetable={timetable}
          existing={existing}
          onRequestScope={onRequestScope}
        />
      ) : null}
    </Modal>
  );
}

function ClassEditorForm({
  onBackInterceptorChange,
  onClose,
  weekday,
  date,
  timeSlot,
  slotSpan,
  endTime,
  timetable,
  existing,
  onRequestScope,
}: Omit<ClassEditorModalProps, "visible"> & { onBackInterceptorChange: (handler: BackInterceptor) => void }) {
  const { colors, spacing, typography, borderWidth } = useTheme();
  const { t, format } = useI18n();
  const { state, upsertPlacement, deletePlacement, setDefaultReminder } = useAppState();
  const reminderStatus = useReminderStatus();

  const defaultReminderMinutes = state.settings.defaultReminderMinutes;

  const [name, setName] = useState(existing?.course.name ?? "");
  const [room, setRoom] = useState(existing?.course.room ?? "");
  const [teacher, setTeacher] = useState(existing?.course.teacher ?? "");
  const [notes, setNotes] = useState(existing?.course.notes ?? "");
  /*
   * The colour this occurrence currently reads as — which a previous "only
   * this occurrence" edit may have set apart from its series — and, for a
   * brand-new class, the next colour in the rotation.
   *
   * Seeded once, when the form mounts, so the suggested colour cannot change
   * underneath the user while they are typing a name.
   */
  const [appearanceId, setAppearanceId] = useState<ClassColorId>(
    () => (existing?.course.appearanceId as ClassColorId | undefined) ?? nextClassColorId(state.courses),
  );
  // Recurrence is a property of the series, never of the occurrence that was
  // tapped — so these read from the series even when this occurrence has
  // been moved or altered on its own.
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>(existing?.basePlacement.recurrenceType ?? "weekly");
  // A one-off defaults to the day that was tapped.
  const [onceDate, setOnceDate] = useState(
    existing?.basePlacement.recurrenceType === "once" ? existing.basePlacement.startsOn : date,
  );
  /**
   * A new class starts at the current global default; an existing one shows
   * the reminder *this occurrence* has, which a one-off edit may have set
   * apart from the rest of its series.
   */
  const [reminderMinutes, setReminderMinutes] = useState<ReminderMinutes>(
    existing ? existing.placement.reminderMinutes : defaultReminderMinutes,
  );
  const [makeReminderDefault, setMakeReminderDefault] = useState(false);
  const [moreDetailsOpen, setMoreDetailsOpen] = useState(false);
  const [openPicker, setOpenPicker] = useState<OpenPicker>(null);
  const [nameError, setNameError] = useState<DomainError | undefined>();
  const [formError, setFormError] = useState<DomainError | undefined>();

  const isOneOff = recurrenceType === "once";

  /*
   * The series' dates, which the user is not asked for and does not see —
   * only a one-off's date is offered, because it is the lesson itself. A
   * stored series keeps its anchor, end and `startsWithTimetable` exactly as
   * they are; a new one anchors on the tapped week. See `classEditorSchedule`.
   */
  const schedule = classEditorSchedule({
    recurrenceType,
    tappedDate: date,
    onceDate,
    timetableStart: timetable.anchorDate,
    base: existing?.basePlacement,
  });

  const RECURRENCE_OPTIONS: { label: string; value: RecurrenceType }[] = [
    { label: t("recurrence.weekly"), value: "weekly" },
    { label: t("recurrence.biweekly"), value: "biweekly" },
    { label: t("recurrence.once"), value: "once" },
  ];

  /*
   * Offered only when the choice actually differs from what new classes
   * already get — compared against the current default, whatever it now is,
   * rather than against the value it started life as. Picking the default
   * again is not a decision worth asking a question about.
   */
  const reminderDiffersFromDefault = reminderMinutes !== defaultReminderMinutes;
  const remindersBlocked = reminderStatus.permission === "denied";

  /*
   * "One time on 3 Nov" / "Repeats every week" / "Repeats every two weeks".
   *
   * The two recurring forms no longer name an end date because there is not
   * one to name: a repeating class runs until the user changes or deletes it.
   * The sentence used to read "Every week until 22 Dec", where the date was
   * the estimate onboarding had made them type months earlier — and the single
   * most surprising thing in the app was discovering it had been enforced.
   */
  const summaryText = isOneOff
    ? t("classEditor.summaryOnce", { date: format.dateLong(onceDate) })
    : recurrenceType === "biweekly"
      ? t("classEditor.summaryBiweekly")
      : t("classEditor.summaryWeekly");

  const slotText =
    slotSpan > 1
      ? t("classEditor.slotSpan", {
          weekday: format.weekdayLong(weekday),
          from: timeSlot.position,
          to: timeSlot.position + slotSpan - 1,
          start: timeSlot.startTime,
          end: endTime,
        })
      : t("classEditor.slot", {
          weekday: format.weekdayLong(weekday),
          period: timeSlot.position,
          start: timeSlot.startTime,
          end: endTime,
        });

  function togglePicker(picker: Exclude<OpenPicker, null>) {
    setOpenPicker((current) => (current === picker ? null : picker));
  }

  const dateSheetOpen = openPicker === "date";

  // While the date sheet is open, Back closes the sheet and leaves the editor.
  useEffect(() => {
    if (!dateSheetOpen) return;
    onBackInterceptorChange(() => {
      setOpenPicker(null);
      return true;
    });
    return () => onBackInterceptorChange(null);
  }, [dateSheetOpen, onBackInterceptorChange]);

  function handleDateConfirm(value: string) {
    setOnceDate(value);
    setOpenPicker(null);
  }

  function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError({ key: "errors.classNameRequired" });
      return;
    }
    setNameError(undefined);
    setFormError(undefined);

    // The global default is a separate decision from this class's reminder,
    // and it is not scoped to a series — so it is committed on its own,
    // whichever of the two paths below the class itself takes.
    if (makeReminderDefault) setDefaultReminder({ reminderMinutes });

    /*
     * A class that repeats cannot be saved outright: the same form could
     * mean a change to one lesson, to the rest of the term, or to the whole
     * series, and only the user knows which. It leaves as a draft, and the
     * timetable screen asks. A class that meets once has no series to
     * choose between, so it is written straight through.
     */
    if (existing && existing.basePlacement.recurrenceType !== "once") {
      const pending = createPendingClassEdit({
        occurrence: existing,
        source: "editor",
        effectiveDate: date,
        weekday,
        timeSlotId: timeSlot.id,
        slotSpan,
        name: trimmedName,
        room: room.trim(),
        teacher: teacher.trim(),
        notes: notes.trim(),
        // Colour goes through the draft like every other course field, so it
        // is scoped by the same question and rebased by the same rules.
        appearanceId,
        recurrenceType,
        startsOn: schedule.startsOn,
        endsOn: schedule.endsOn,
        // Undefined: the series keeps whatever it already was.
        startsWithTimetable: schedule.startsWithTimetable,
        reminderMinutes,
      });

      const check = validateClassEditDraft(pending.draft);
      if (!check.ok) {
        setFormError(check.error);
        return;
      }
      // Nothing to apply, so nothing to ask about.
      if (draftHasChanges(pending.draft)) onRequestScope(pending);
      onClose();
      return;
    }

    const result = upsertPlacement({
      placementId: existing?.basePlacement.id,
      weekday,
      timeSlotId: timeSlot.id,
      slotSpan,
      name: trimmedName,
      room,
      teacher,
      notes,
      appearanceId,
      recurrenceType,
      startsOn: schedule.startsOn,
      endsOn: schedule.endsOn,
      startsWithTimetable: schedule.startsWithTimetable ?? true,
      reminderMinutes,
    });

    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    onClose();
  }

  function handleDelete() {
    if (!existing) return;
    Alert.alert(t("classEditor.deleteTitle"), t("classEditor.deleteMessage", { name: existing.course.name }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () => {
          deletePlacement(existing.basePlacement.id);
          onClose();
        },
      },
    ]);
  }

  return (
    /*
     * A gesture root of its own, and this is not optional.
     *
     * A React Native `Modal` is a separate native window — a Dialog on Android,
     * its own view controller on iOS — so nothing inside it is a descendant of
     * the `GestureHandlerRootView` in the root layout. Gesture Handler
     * recognisers mounted in here are simply never handed the touches, which is
     * why the month pager's horizontal swipe stopped working the moment the date
     * fields moved into this editor: the pager was unchanged and correct, and it
     * was not receiving anything. It worked on the old term screen because that
     * was an ordinary pushed screen, inside the root.
     */
    <GestureHandlerRootView style={styles.flex}>
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} edges={["top", "left", "right", "bottom"]}>
      <View
        style={[
          styles.headerRow,
          {
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.sm,
            backgroundColor: colors.headerBackground,
            borderBottomWidth: borderWidth.thin,
            borderColor: colors.divider,
            gap: spacing.sm,
          },
        ]}
      >
        {/* Both header actions are full 44-point targets with generous
            retention: these are the two presses in the app it is least
            acceptable to lose, and a short word of text is a small thing to
            aim at. */}
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("common.cancel")}
          hitSlop={8}
          pressRetentionOffset={{ top: 20, bottom: 20, left: 20, right: 20 }}
          style={({ pressed }) => [styles.headerAction, { opacity: pressed ? 0.5 : 1 }]}
        >
          <Text style={[typography.label, { color: colors.textSecondary }]}>{t("common.cancel")}</Text>
        </Pressable>
        {/* The title takes what is left between the two actions and centres in
            it, so "Kurs bearbeiten" cannot push Save off the row. */}
        <Text style={[typography.subtitle, styles.headerTitle, { color: colors.textPrimary }]} numberOfLines={1}>
          {existing ? t("classEditor.editTitle") : t("classEditor.newTitle")}
        </Text>
        <Pressable
          onPress={handleSave}
          accessibilityRole="button"
          accessibilityLabel={t("common.save")}
          hitSlop={8}
          pressRetentionOffset={{ top: 20, bottom: 20, left: 20, right: 20 }}
          style={({ pressed }) => [styles.headerAction, styles.headerActionEnd, { opacity: pressed ? 0.5 : 1 }]}
        >
          <Text style={[typography.label, { color: colors.accentStrong, fontWeight: "700" }]}>{t("common.save")}</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.lg }}>
          {/* When and how long, as a subtitle: it is what this form is about,
              not one of the things it asks for. */}
          <Text style={[typography.body, { color: colors.textSecondary }]}>{slotText}</Text>

          <FormSection>
          <TextField
            label={t("classEditor.name")}
            value={name}
            onChangeText={setName}
            autoFocus={!existing}
            error={nameError ? t(nameError.key, nameError.params) : undefined}
            placeholder={t("classEditor.namePlaceholder")}
          />
          <TextField
            label={t("classEditor.room")}
            value={room}
            onChangeText={setRoom}
            placeholder={t("common.optional")}
          />

          {/* Above the fold, next to the room: a class's colour is how it is
              recognised on the grid, not one of the details worth folding
              away. Its swatch previews immediately; nothing is written until
              Save. */}
          <ClassColorField
            value={appearanceId}
            onChange={setAppearanceId}
            expanded={openPicker === "color"}
            onToggle={() => togglePicker("color")}
          />

          {/* Compact and above the fold: a reminder is part of what a class
              is, not one of the details worth folding away. */}
          <ReminderField
            label={t("classEditor.reminder")}
            value={reminderMinutes}
            onChange={setReminderMinutes}
            helperText={remindersBlocked ? t("classEditor.remindersBlocked") : undefined}
          />

          {/* Inside the group, not after it: it is a row about the row above
              it, and standing outside the run of hairlines made it read as a
              stray control that belonged to the page rather than to the
              reminder. */}
          {reminderDiffersFromDefault ? (
            <SwitchRow
              label={t("classEditor.useAsDefaultReminder")}
              description={t("classEditor.currentDefaultReminder", {
                value: format.reminderValue(defaultReminderMinutes),
              })}
              value={makeReminderDefault}
              onValueChange={setMakeReminderDefault}
            />
          ) : null}
          </FormSection>

          <Text style={[typography.caption, { color: colors.textSecondary, marginTop: spacing.lg }]}>
            {summaryText}
          </Text>

          <Pressable
            onPress={() => setMoreDetailsOpen((open) => !open)}
            accessibilityRole="button"
            accessibilityLabel={moreDetailsOpen ? t("classEditor.hideMoreDetails") : t("classEditor.showMoreDetails")}
            hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}
            pressRetentionOffset={{ top: 16, bottom: 16, left: 24, right: 24 }}
            style={({ pressed }) => [styles.disclosure, { marginBottom: spacing.sm, opacity: pressed ? 0.5 : 1 }]}
          >
            <Text style={[typography.label, { color: colors.accentStrong }]}>
              {moreDetailsOpen ? t("classEditor.hideDetails") : t("classEditor.moreDetails")}
            </Text>
          </Pressable>

          {moreDetailsOpen ? (
            <FormSection>
              <TextField
                label={t("classEditor.teacher")}
                value={teacher}
                onChangeText={setTeacher}
                placeholder={t("common.optional")}
              />
              <TextField
                label={t("classEditor.notes")}
                value={notes}
                onChangeText={setNotes}
                placeholder={t("common.optional")}
                multiline
              />

              <ChoiceRowField
                label={t("classEditor.recurrence")}
                value={recurrenceType}
                options={RECURRENCE_OPTIONS}
                onChange={setRecurrenceType}
                sheetTitle={t("recurrence.label")}
              />

              {/* Only a one-off has a date to pick: it is the lesson itself. A
                  repeating class has no start-date row — where its series is
                  anchored is internal, and the timetable's start is the date
                  the user controls. Opens the date sheet over the form. */}
              {schedule.dateField === "occurrenceDate" ? (
                <DateField label={t("classEditor.date")} value={onceDate} onPress={() => setOpenPicker("date")} />
              ) : null}
            </FormSection>
          ) : null}

          {formError ? (
            <Text style={[typography.caption, { color: colors.danger, marginBottom: spacing.md }]}>
              {t(formError.key, formError.params)}
            </Text>
          ) : null}

          {existing ? (
            <View style={{ marginTop: spacing.md, borderTopWidth: borderWidth.thin, borderColor: colors.divider, paddingTop: spacing.lg }}>
              <Button label={t("classEditor.deleteClass")} variant="destructive" onPress={handleDelete} />
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>

      {/* Over the whole editor and still inside its gesture root, which is
          what keeps the month pager's swipe working in here. */}
      {dateSheetOpen ? (
        <DatePickerSheet
          title={t("classEditor.date")}
          value={onceDate}
          onCancel={() => setOpenPicker(null)}
          onConfirm={handleDateConfirm}
        />
      ) : null}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
  },
  headerAction: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: "center",
  },
  headerActionEnd: {
    alignItems: "flex-end",
  },
  disclosure: {
    minHeight: 44,
    justifyContent: "center",
  },
});
