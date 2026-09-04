import { useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { InlineDateField } from "@/components/InlineDateField";
import { ReminderField } from "@/components/ReminderField";
import { SegmentedControl } from "@/components/SegmentedControl";
import { SwitchRow } from "@/components/SwitchRow";
import { TextField } from "@/components/TextField";
import { formatIsoLong } from "@/domain/calendar";
import {
  createPendingClassEdit,
  draftHasChanges,
  validateClassEditDraft,
  type PendingClassEdit,
} from "@/domain/classEdit";
import { defaultSeriesStartDate } from "@/domain/recurrence";
import { formatReminderLabel, type ReminderMinutes } from "@/domain/reminder";
import { WEEKDAY_LABEL, type Weekday } from "@/domain/week";
import type { ScheduledClass } from "@/domain/timetable";
import { useReminderStatus } from "@/features/reminders/useReminderStatus";
import { useAppState } from "@/state/AppStateContext";
import { useTheme } from "@/theme/useTheme";
import type { AcademicTerm, RecurrenceType, TimeSlot } from "@/types/models";

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
  term: AcademicTerm;
  existing?: ScheduledClass;
  /**
   * Edits to a repeating class leave here as a draft rather than as a
   * change: the screen asks which occurrences they apply to first.
   */
  onRequestScope: (edit: PendingClassEdit) => void;
}

/** Which inline picker is unfolded — at most one at a time. */
type OpenPicker = "date" | "startsOn" | "endsOn" | null;

const RECURRENCE_OPTIONS: { label: string; value: RecurrenceType }[] = [
  { label: "Weekly", value: "weekly" },
  { label: "Every 2 wks", value: "biweekly" },
  { label: "One time", value: "once" },
];

export function ClassEditorModal({
  visible,
  onClose,
  weekday,
  date,
  timeSlot,
  slotSpan,
  endTime,
  term,
  existing,
  onRequestScope,
}: ClassEditorModalProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle={Platform.OS === "ios" ? "fullScreen" : undefined}
    >
      {visible ? (
        <ClassEditorForm
          key={`${weekday}-${date}-${timeSlot.id}-${existing?.occurrenceId ?? "new"}`}
          onClose={onClose}
          weekday={weekday}
          date={date}
          timeSlot={timeSlot}
          slotSpan={slotSpan}
          endTime={endTime}
          term={term}
          existing={existing}
          onRequestScope={onRequestScope}
        />
      ) : null}
    </Modal>
  );
}

function ClassEditorForm({
  onClose,
  weekday,
  date,
  timeSlot,
  slotSpan,
  endTime,
  term,
  existing,
  onRequestScope,
}: Omit<ClassEditorModalProps, "visible">) {
  const { colors, spacing, typography, borderWidth } = useTheme();
  const { state, upsertPlacement, deletePlacement, setDefaultReminder } = useAppState();
  const reminderStatus = useReminderStatus();

  const defaultReminderMinutes = state.settings.defaultReminderMinutes;

  const [name, setName] = useState(existing?.course.name ?? "");
  const [room, setRoom] = useState(existing?.course.room ?? "");
  const [teacher, setTeacher] = useState(existing?.course.teacher ?? "");
  const [notes, setNotes] = useState(existing?.course.notes ?? "");
  // Recurrence is a property of the series, never of the occurrence that was
  // tapped — so these read from the series even when this occurrence has
  // been moved or altered on its own.
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>(existing?.basePlacement.recurrenceType ?? "weekly");
  const [startsOn, setStartsOn] = useState(
    existing && existing.basePlacement.recurrenceType !== "once"
      ? existing.basePlacement.startsOn
      : defaultSeriesStartDate(existing?.basePlacement.recurrenceType ?? "weekly", date, term.startDate),
  );
  /**
   * Whether the start date is the user's own choice. An existing series
   * always owns its start; a new one follows the recurrence type until the
   * user picks a date, after which it stops moving underneath them.
   */
  const [startDateIsOwn, setStartDateIsOwn] = useState(Boolean(existing));
  const [endsOn, setEndsOn] = useState(existing?.basePlacement.endsOn ?? term.estimatedEndDate);
  // A one-off defaults to the day that was tapped, not the start of term.
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
  const [nameError, setNameError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | undefined>();

  const isOneOff = recurrenceType === "once";
  const effectiveStartsOn = isOneOff ? onceDate : startsOn;
  const effectiveEndsOn = isOneOff ? onceDate : endsOn;

  /*
   * Offered only when the choice actually differs from what new classes
   * already get — compared against the current default, whatever it now is,
   * rather than against the value it started life as. Picking the default
   * again is not a decision worth asking a question about.
   */
  const reminderDiffersFromDefault = reminderMinutes !== defaultReminderMinutes;
  const remindersBlocked = reminderStatus.permission === "denied";

  const summaryText = isOneOff
    ? `One time on ${formatIsoLong(onceDate)}`
    : recurrenceType === "biweekly"
      ? `Every two weeks until ${formatIsoLong(effectiveEndsOn)}`
      : `Every week until ${formatIsoLong(effectiveEndsOn)}`;

  function togglePicker(picker: Exclude<OpenPicker, null>) {
    setOpenPicker((current) => (current === picker ? null : picker));
  }

  /**
   * Choosing "every 2 weeks" also chooses which half of the fortnight the
   * class falls on, and the start date is where that is recorded — so a new
   * class re-anchors on the week the user tapped. Left at the start of term
   * it would land on the same alternating weeks as every other one, and
   * collide with all of them.
   */
  function handleRecurrenceChange(next: RecurrenceType) {
    setRecurrenceType(next);
    if (!startDateIsOwn) setStartsOn(defaultSeriesStartDate(next, date, term.startDate));
  }

  function handleStartDateChange(value: string) {
    setStartDateIsOwn(true);
    setStartsOn(value);
  }

  function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError("Class name is required.");
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
        recurrenceType,
        startsOn: effectiveStartsOn,
        endsOn: effectiveEndsOn,
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
      recurrenceType,
      startsOn: effectiveStartsOn,
      endsOn: effectiveEndsOn,
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
    Alert.alert("Delete class?", `Remove ${existing.course.name} from the timetable. This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          deletePlacement(existing.basePlacement.id);
          onClose();
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} edges={["top", "left", "right", "bottom"]}>
      <View
        style={[
          styles.headerRow,
          { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: borderWidth.thin, borderColor: colors.border },
        ]}
      >
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Cancel" hitSlop={8}>
          <Text style={[typography.label, { color: colors.textSecondary }]}>Cancel</Text>
        </Pressable>
        <Text style={[typography.subtitle, { color: colors.textPrimary }]}>{existing ? "Edit class" : "New class"}</Text>
        <Pressable onPress={handleSave} accessibilityRole="button" accessibilityLabel="Save" hitSlop={8}>
          <Text style={[typography.label, { color: colors.accent, fontWeight: "700" }]}>Save</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.lg }}>
          <Text style={[typography.caption, { color: colors.textMuted, marginBottom: spacing.md }]}>
            {WEEKDAY_LABEL[weekday]} · period {timeSlot.position}
            {slotSpan > 1 ? `–${timeSlot.position + slotSpan - 1}` : ""} · {timeSlot.startTime}–{endTime}
          </Text>

          <TextField
            label="Class name"
            value={name}
            onChangeText={setName}
            autoFocus={!existing}
            error={nameError}
            placeholder="e.g. Mathematics"
          />
          <TextField label="Room" value={room} onChangeText={setRoom} placeholder="Optional" />

          {/* Compact and above the fold: a reminder is part of what a class
              is, not one of the details worth folding away. */}
          <ReminderField
            label="Reminder"
            value={reminderMinutes}
            onChange={setReminderMinutes}
            helperText={remindersBlocked ? "Reminders are off until notification permission is granted." : undefined}
          />

          {reminderDiffersFromDefault ? (
            <SwitchRow
              label="Use as default for new classes"
              description={`New classes currently start at ${formatReminderLabel(defaultReminderMinutes)}.`}
              value={makeReminderDefault}
              onValueChange={setMakeReminderDefault}
            />
          ) : null}

          <Text style={[typography.caption, { color: colors.textSecondary, marginTop: spacing.md, marginBottom: spacing.md }]}>
            {summaryText}
          </Text>

          <Pressable
            onPress={() => setMoreDetailsOpen((open) => !open)}
            accessibilityRole="button"
            accessibilityLabel={moreDetailsOpen ? "Hide more details" : "Show more details"}
            style={{ marginBottom: spacing.sm }}
          >
            <Text style={[typography.label, { color: colors.accent }]}>{moreDetailsOpen ? "Hide details" : "More details"}</Text>
          </Pressable>

          {moreDetailsOpen ? (
            <View>
              <TextField label="Teacher" value={teacher} onChangeText={setTeacher} placeholder="Optional" />
              <TextField label="Notes" value={notes} onChangeText={setNotes} placeholder="Optional" multiline />

              <Text style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.xs }]}>Recurrence</Text>
              <View style={{ marginBottom: spacing.md }}>
                <SegmentedControl
                  options={RECURRENCE_OPTIONS}
                  value={recurrenceType}
                  onChange={handleRecurrenceChange}
                  accessibilityLabel="Recurrence"
                />
              </View>

              {isOneOff ? (
                <InlineDateField
                  label="Date"
                  value={onceDate}
                  onChange={setOnceDate}
                  expanded={openPicker === "date"}
                  onToggle={() => togglePicker("date")}
                />
              ) : (
                <>
                  <InlineDateField
                    label="Start date"
                    value={startsOn}
                    onChange={handleStartDateChange}
                    expanded={openPicker === "startsOn"}
                    onToggle={() => togglePicker("startsOn")}
                    helperText={
                      recurrenceType === "biweekly" ? "Sets which alternating week this class falls on" : undefined
                    }
                  />
                  <InlineDateField
                    label="End date"
                    value={endsOn}
                    onChange={setEndsOn}
                    expanded={openPicker === "endsOn"}
                    onToggle={() => togglePicker("endsOn")}
                    helperText="Estimated — can be changed later"
                  />
                </>
              )}
            </View>
          ) : null}

          {formError ? (
            <Text style={[typography.caption, { color: colors.destructive, marginBottom: spacing.md }]}>{formError}</Text>
          ) : null}

          {existing ? (
            <View style={{ marginTop: spacing.md, borderTopWidth: borderWidth.thin, borderColor: colors.border, paddingTop: spacing.lg }}>
              <Button label="Delete class" variant="destructive" onPress={handleDelete} />
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
});
