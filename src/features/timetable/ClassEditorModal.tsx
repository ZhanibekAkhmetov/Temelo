import { useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/Button";
import { DateInput } from "@/components/DateInput";
import { SegmentedControl } from "@/components/SegmentedControl";
import { TextField } from "@/components/TextField";
import { formatIsoAsDmy } from "@/domain/date";
import { WEEKDAY_LABEL, type Weekday } from "@/domain/week";
import { useAppState } from "@/state/AppStateContext";
import { useTheme } from "@/theme/useTheme";
import type { AcademicTerm, Course, Placement, RecurrenceType, TimeSlot } from "@/types/models";

interface ExistingSelection {
  placement: Placement;
  course: Course;
}

interface ClassEditorModalProps {
  visible: boolean;
  onClose: () => void;
  weekday: Weekday;
  timeSlot: TimeSlot;
  term: AcademicTerm;
  existing?: ExistingSelection;
}

const RECURRENCE_OPTIONS: { label: string; value: RecurrenceType }[] = [
  { label: "Weekly", value: "weekly" },
  { label: "Every 2 wks", value: "biweekly" },
  { label: "One time", value: "once" },
];

export function ClassEditorModal({ visible, onClose, weekday, timeSlot, term, existing }: ClassEditorModalProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle={Platform.OS === "ios" ? "fullScreen" : undefined}
    >
      {visible ? (
        <ClassEditorForm
          key={`${weekday}-${timeSlot.id}-${existing?.placement.id ?? "new"}`}
          onClose={onClose}
          weekday={weekday}
          timeSlot={timeSlot}
          term={term}
          existing={existing}
        />
      ) : null}
    </Modal>
  );
}

function ClassEditorForm({ onClose, weekday, timeSlot, term, existing }: Omit<ClassEditorModalProps, "visible">) {
  const { colors, spacing, typography, borderWidth } = useTheme();
  const { upsertPlacement, deletePlacement } = useAppState();

  const [name, setName] = useState(existing?.course.name ?? "");
  const [room, setRoom] = useState(existing?.course.room ?? "");
  const [teacher, setTeacher] = useState(existing?.course.teacher ?? "");
  const [notes, setNotes] = useState(existing?.course.notes ?? "");
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>(existing?.placement.recurrenceType ?? "weekly");
  const [startsOn, setStartsOn] = useState(existing?.placement.startsOn ?? term.startDate);
  const [endsOn, setEndsOn] = useState(existing?.placement.endsOn ?? term.estimatedEndDate);
  const [moreDetailsOpen, setMoreDetailsOpen] = useState(false);
  const [nameError, setNameError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | undefined>();

  const effectiveEndsOn = recurrenceType === "once" ? startsOn : endsOn;

  const summaryText =
    recurrenceType === "once"
      ? `One time on ${formatIsoAsDmy(startsOn)}`
      : recurrenceType === "biweekly"
        ? `Every two weeks until ${formatIsoAsDmy(effectiveEndsOn)}`
        : `Every week until ${formatIsoAsDmy(effectiveEndsOn)}`;

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
      name: trimmedName,
      room,
      teacher,
      notes,
      recurrenceType,
      startsOn,
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
            {WEEKDAY_LABEL[weekday]} · period {timeSlot.position} · {timeSlot.startTime}–{timeSlot.endTime}
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

              <DateInput label="Start date" value={startsOn} onChangeText={setStartsOn} helperText="e.g. 01.09.2026" />
              {recurrenceType !== "once" ? (
                <DateInput label="End date" value={endsOn} onChangeText={setEndsOn} helperText="Estimated — can be changed later" />
              ) : null}
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
