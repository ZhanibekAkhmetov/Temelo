import { useMemo, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

import { DurationField } from "@/components/DurationField";
import { FormSection } from "@/components/FormSection";
import { InlineTimeField } from "@/components/InlineTimeField";
import { OnboardingNav } from "@/components/OnboardingNav";
import { ScreenContainer } from "@/components/ScreenContainer";
import { StepperField } from "@/components/StepperField";
import { generateTimeSlots, MAX_SLOT_COUNT } from "@/domain/time";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppState } from "@/state/AppStateContext";
import { useTheme } from "@/theme/useTheme";

export default function AcademicDayConfigScreen() {
  const { colors, spacing, typography, borderWidth } = useTheme();
  const { t } = useI18n();
  const { state, setAcademicDayConfig } = useAppState();

  const [dayStart, setDayStart] = useState(state.settings.academicDayStart);
  const [lessonDuration, setLessonDuration] = useState(state.settings.defaultLessonDurationMinutes);
  const [breakDuration, setBreakDuration] = useState(state.settings.defaultBreakDurationMinutes);
  const [slotCount, setSlotCount] = useState(state.settings.slotCount);
  const [startTimePickerOpen, setStartTimePickerOpen] = useState(false);

  const isPostOnboardingEdit = state.settings.onboardingCompleted;
  const hasActivePlacements = state.placements.some((placement) => !placement.deletedAt);

  const preview = useMemo(
    () =>
      generateTimeSlots({
        dayStart,
        lessonDurationMinutes: lessonDuration,
        breakDurationMinutes: breakDuration,
        slotCount,
      }),
    [dayStart, lessonDuration, breakDuration, slotCount],
  );

  function save() {
    const result = setAcademicDayConfig({
      academicDayStart: dayStart,
      defaultLessonDurationMinutes: lessonDuration,
      defaultBreakDurationMinutes: breakDuration,
      slotCount,
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
      Alert.alert(t("onboarding.regenerateTitle"), t("onboarding.regenerateMessage"), [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("common.continue"), style: "destructive", onPress: save },
      ]);
      return;
    }
    save();
  }

  return (
    <ScreenContainer>
      <Text style={[typography.title, { color: colors.textPrimary }]}>{t("onboarding.academicDayTitle")}</Text>
      <Text style={[typography.body, { color: colors.textSecondary, marginTop: spacing.xs }]}>
        {t("onboarding.academicDaySubtitle")}
      </Text>

      <FormSection>
        <InlineTimeField
          label={t("onboarding.dayStart")}
          value={dayStart}
          onChange={setDayStart}
          expanded={startTimePickerOpen}
          onToggle={() => setStartTimePickerOpen((open) => !open)}
        />
        <DurationField
          label={t("onboarding.lessonDuration")}
          valueMinutes={lessonDuration}
          onChange={setLessonDuration}
          minimumMinutes={5}
        />
        <DurationField
          label={t("onboarding.breakDuration")}
          valueMinutes={breakDuration}
          onChange={setBreakDuration}
          minimumMinutes={0}
        />
        {/*
         * A stepper, not a keyboard. This is a number between one and sixteen
         * that is almost never changed by more than one, and typing it meant
         * covering the preview below with a keypad in order to edit the value
         * the preview exists to explain.
         */}
        <StepperField
          label={t("onboarding.slotCount")}
          value={slotCount}
          minimum={1}
          maximum={MAX_SLOT_COUNT}
          onChange={setSlotCount}
        />
      </FormSection>

      {/*
       * The generated day, as the rows it will actually become.
       *
       * Not in a bordered box any more: it was a second kind of container on a
       * screen already made of rows, and at eight periods it was the largest
       * thing on the page. As hairline rows under a heading it is the same
       * information in the same language as the fields above it, and it reads
       * as the *result* of them rather than as another control.
       */}
      <FormSection title={t("onboarding.preview")}>
        {preview.ok ? (
          preview.slots.map((slot, index) => (
            <View
              key={slot.position}
              style={[
                styles.previewRow,
                {
                  paddingVertical: spacing.xs,
                  borderTopWidth: index === 0 ? 0 : borderWidth.thin,
                  borderColor: colors.divider,
                },
              ]}
            >
              <Text style={[typography.caption, styles.previewPosition, { color: colors.textMuted }]}>
                {slot.position}
              </Text>
              <Text style={[typography.body, { color: colors.textPrimary }]}>
                {slot.startTime}–{slot.endTime}
              </Text>
            </View>
          ))
        ) : (
          <Text style={[typography.caption, { color: colors.danger, paddingVertical: spacing.sm }]}>
            {t(preview.error.key, preview.error.params)}
          </Text>
        )}
      </FormSection>

      <OnboardingNav
        onBack={() => router.back()}
        onContinue={handleContinue}
        continueLabel={isPostOnboardingEdit ? t("common.save") : t("common.continue")}
        continueDisabled={!preview.ok}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  previewPosition: {
    width: 20,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
});
