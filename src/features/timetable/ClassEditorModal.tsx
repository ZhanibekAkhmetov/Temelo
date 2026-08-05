import { useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { InlineDateField } from "@/components/InlineDateField";
import { SegmentedControl } from "@/components/SegmentedControl";
import { TextField } from "@/components/TextField";
import { formatIsoLong } from "@/domain/calendar";
import { WEEKDAY_LABEL, type Weekday } from "@/domain/week";
import type { ScheduledClass } from "@/domain/timetable";
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
}

/** Which inline picker is unfolded — at most one at a time. */
type OpenPicker = "date" | "startsOn" | "endsOn" | null;

const RECURRENCE_OPTIONS: { label: string; value: RecurrenceType }[] = [
  { label: "Weekly", value: "weekly" },
  { label: "Every 2 wks", value: "biweekly" },
  { label: "One time", value: "once" },
];

export function ClassEditorModal({ visible, onClose, weekday, date, timeSlot, slotSpan, endTime, term, existing }: ClassEditorModalProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle={Platform.OS === "ios" ? "fullScreen" : undefined}
    >
      {visible ? (
        <ClassEditorForm
          key={`${weekday}-${date}-${timeSlot.id}-${existing?.placement.id ?? "new"}`}
          onClose={onClose}
          weekday={weekday}
          date={date}
          timeSlot={timeSlot}
          slotSpan={slotSpan}
          endTime={endTime}
          term={term}
          existing={existing}
        />
      ) : null}
    </Modal>
  );
}

function ClassEditorForm({ onClose, weekday, date, timeSlot, slotSpan, endTime, term, existing }: Omit<ClassEditorModalProps, "visible">) {
  const { colors, spacing, typography, borderWidth } = useTheme();
  const { upsertPlacement, deletePlacement } = useAppState();

  const [name, setName] = useState(existing?.course.name ?? "");
  const [room, setRoom] = useState(existing?.course.room ?? "");
  const [teacher, setTeacher] = useState(existing?.course.teacher ?? "");
  const [notes, setNotes] = useState(existing?.course.notes ?? "");
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>(existing?.placement.recurrenceType ?? "weekly");
  const [startsOn, setStartsOn] = useState(
    existing && existing.placement.recurrenceType !== "once" ? existing.placement.startsOn : term.startDate,
  );
  const [endsOn, setEndsOn] = useState(existing?.placement.endsOn ?? term.estimatedEndDate);
  // A one-off defaults to the day that was tapped, not the start of term.
  const [onceDate, setOnceDate] = useState(
    existing?.placement.recurrenceType === "once" ? existing.placement.startsOn : date,
  );
  const [moreDetailsOpen, setMoreDetailsOpen] = useState(false);
  const [openPicker, setOpenPicker] = useState<OpenPicker>(null);
  const [nameError, setNameError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | undefined>();

  const isOneOff = recurrenceType === "once";
  const effectiveStartsOn = isOneOff ? onceDate : startsOn;
  const effectiveEndsOn = isOneOff ? onceDate : endsOn;

  const summaryText = isOneOff
    ? `One time on ${formatIsoLong(onceDate)}`
    : recurrenceType === "biweekly"
      ? `Every two weeks until ${formatIsoLong(effectiveEndsOn)}`
      : `Every week until ${formatIsoLong(effectiveEndsOn)}`;

  function togglePicker(picker: Exclude<OpenPicker, null>) {
    setOpenPicker((current) => (current === picker ? null : picker));
  }

  function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError("Class name is required.");
      return;
    }
    setNameError(undefined);
    setFormError(undefined);

    const result = upsertPlacement({
      placementId: existing?.placement.id,
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
          deletePlacement(existing.placement.id);
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

          <Text style={[typography.caption, { color: colors.textSecondary, marginBottom: spacing.md }]}>{summaryText}</Text>

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
                <SegmentedControl options={RECURRENCE_OPTIONS} value={recurrenceType} onChange={setRecurrenceType} accessibilityLabel="Recurrence" />
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
                    onChange={setStartsOn}
                    expanded={openPicker === "startsOn"}
                    onToggle={() => togglePicker("startsOn")}
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
