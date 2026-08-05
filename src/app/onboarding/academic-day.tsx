import { useMemo, useState } from "react";
import { Alert, Text, View } from "react-native";
import { router } from "expo-router";

import { DurationField } from "@/components/DurationField";
import { InlineTimeField } from "@/components/InlineTimeField";
import { OnboardingNav } from "@/components/OnboardingNav";
import { ScreenContainer } from "@/components/ScreenContainer";
import { TextField } from "@/components/TextField";
import { generateTimeSlots } from "@/domain/time";
import { useAppState } from "@/state/AppStateContext";
import { useTheme } from "@/theme/useTheme";

export default function AcademicDayConfigScreen() {
  const { colors, spacing, typography, borderWidth } = useTheme();
  const { state, setAcademicDayConfig } = useAppState();

  const [dayStart, setDayStart] = useState(state.settings.academicDayStart);
  const [lessonDuration, setLessonDuration] = useState(state.settings.defaultLessonDurationMinutes);
  const [breakDuration, setBreakDuration] = useState(state.settings.defaultBreakDurationMinutes);
  const [slotCount, setSlotCount] = useState(String(state.settings.slotCount));
  const [startTimePickerOpen, setStartTimePickerOpen] = useState(false);

  const isPostOnboardingEdit = state.settings.onboardingCompleted;
  const hasActivePlacements = state.placements.some((p) => !p.deletedAt);

  const preview = useMemo(
    () =>
      generateTimeSlots({
        dayStart,
        lessonDurationMinutes: lessonDuration,
        breakDurationMinutes: breakDuration,
        slotCount: Number(slotCount),
      }),
    [dayStart, lessonDuration, breakDuration, slotCount],
  );

  function save() {
    const result = setAcademicDayConfig({
      academicDayStart: dayStart,
      defaultLessonDurationMinutes: lessonDuration,
      defaultBreakDurationMinutes: breakDuration,
      slotCount: Number(slotCount),
    });
    if (!result.ok) return;
    if (isPostOnboardingEdit) {
      router.back();
    } else {
      router.push("/onboarding/term");
    }
  }

  function handleContinue() {
    if (!preview.ok) return;
    if (isPostOnboardingEdit && hasActivePlacements) {
      Alert.alert(
        "Regenerate time slots?",
        "Changing these settings will regenerate time slots and remove existing classes from the timetable. This cannot be undone.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Continue", style: "destructive", onPress: save },
        ],
      );
      return;
    }
    save();
  }

  return (
    <ScreenContainer>
      <Text style={[typography.title, { color: colors.textPrimary }]}>Academic day</Text>
      <Text style={[typography.body, { color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.lg }]}>
        Define your typical academic day to generate time slots.
      </Text>

      <InlineTimeField
        label="Academic day starts at"
        value={dayStart}
        onChange={setDayStart}
        expanded={startTimePickerOpen}
        onToggle={() => setStartTimePickerOpen((open) => !open)}
        helperText="24-hour, in five-minute steps"
      />
      <DurationField label="Lesson duration" valueMinutes={lessonDuration} onChange={setLessonDuration} minimumMinutes={5} />
      <DurationField label="Break between lessons" valueMinutes={breakDuration} onChange={setBreakDuration} minimumMinutes={0} />

      <View style={{ height: spacing.md }} />
      <TextField label="Number of periods" value={slotCount} onChangeText={setSlotCount} keyboardType="numeric" />

      <Text style={[typography.label, { color: colors.textSecondary, marginTop: spacing.sm, marginBottom: spacing.xs }]}>
        Preview
      </Text>
      <View style={{ borderWidth: borderWidth.thin, borderColor: colors.border, borderRadius: 4, overflow: "hidden" }}>
        {preview.ok ? (
          preview.slots.map((slot, index) => (
            <View
              key={slot.position}
              style={{
                flexDirection: "row",
                paddingVertical: spacing.xs,
                paddingHorizontal: spacing.sm,
                borderTopWidth: index === 0 ? 0 : borderWidth.thin,
                borderColor: colors.border,
                backgroundColor: colors.surface,
              }}
            >
              <Text style={[typography.caption, { color: colors.textSecondary, width: 24 }]}>{slot.position}</Text>
              <Text style={[typography.caption, { color: colors.textPrimary }]}>
                {slot.startTime}–{slot.endTime}
              </Text>
            </View>
          ))
        ) : (
          <Text style={[typography.caption, { color: colors.destructive, padding: spacing.sm, backgroundColor: colors.surface }]}>
            {preview.error}
          </Text>
        )}
      </View>

      <OnboardingNav onBack={() => router.back()} onContinue={handleContinue} continueLabel={isPostOnboardingEdit ? "Save" : "Continue"} />
    </ScreenContainer>
  );
}
