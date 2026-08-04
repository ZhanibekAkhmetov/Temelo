import { useMemo, useState } from "react";
import { Alert, Text, View } from "react-native";
import { router } from "expo-router";

import { OnboardingNav } from "@/components/OnboardingNav";
import { ScreenContainer } from "@/components/ScreenContainer";
import { TextField } from "@/components/TextField";
import { TimeInput } from "@/components/TimeInput";
import { generateTimeSlots, isValidHHmm } from "@/domain/time";
import { useAppState } from "@/state/AppStateContext";
import { useTheme } from "@/theme/useTheme";

export default function AcademicDayConfigScreen() {
  const { colors, spacing, typography, borderWidth } = useTheme();
  const { state, setAcademicDayConfig } = useAppState();

  const [dayStart, setDayStart] = useState(state.settings.academicDayStart);
  const [lessonDuration, setLessonDuration] = useState(String(state.settings.defaultLessonDurationMinutes));
  const [breakDuration, setBreakDuration] = useState(String(state.settings.defaultBreakDurationMinutes));
  const [slotCount, setSlotCount] = useState(String(state.settings.slotCount));

  const isPostOnboardingEdit = state.settings.onboardingCompleted;
  const hasActivePlacements = state.placements.some((p) => !p.deletedAt);

  const preview = useMemo(
    () =>
      generateTimeSlots({
        dayStart,
        lessonDurationMinutes: Number(lessonDuration),
        breakDurationMinutes: Number(breakDuration),
        slotCount: Number(slotCount),
      }),
    [dayStart, lessonDuration, breakDuration, slotCount],
  );

  function save() {
    const result = setAcademicDayConfig({
      academicDayStart: dayStart,
      defaultLessonDurationMinutes: Number(lessonDuration),
      defaultBreakDurationMinutes: Number(breakDuration),
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

      <TimeInput
        label="Academic day starts at"
        value={dayStart}
        onChangeText={setDayStart}
        error={dayStart.length > 0 && !isValidHHmm(dayStart) ? "Enter a valid time (HH:mm)." : undefined}
        helperText="24-hour"
      />
      <TextField label="Lesson duration (minutes)" value={lessonDuration} onChangeText={setLessonDuration} keyboardType="numeric" />
      <TextField label="Break duration (minutes)" value={breakDuration} onChangeText={setBreakDuration} keyboardType="numeric" />
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
