import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { DurationField } from "@/components/DurationField";
import { FormSection } from "@/components/FormSection";
import { InlineTimeField } from "@/components/InlineTimeField";
import { StepperField } from "@/components/StepperField";
import { generateTimeSlots, MAX_SLOT_COUNT } from "@/domain/time";
import { useI18n } from "@/i18n/I18nProvider";
import type { AcademicDayConfigInput } from "@/state/AppStateContext";
import { useTheme } from "@/theme/useTheme";

export interface AcademicDayFieldsProps {
  value: AcademicDayConfigInput;
  onChange: (next: AcademicDayConfigInput) => void;
}

/**
 * Whether a configuration generates a usable day.
 *
 * Asked by the screen rather than reported by the component, so the Continue
 * button's enabled state and the preview below it are two readings of one
 * pure function instead of two pieces of state that have to be kept in step.
 */
export function isUsableAcademicDay(value: AcademicDayConfigInput): boolean {
  return generateTimeSlots({
    dayStart: value.academicDayStart,
    lessonDurationMinutes: value.defaultLessonDurationMinutes,
    breakDurationMinutes: value.defaultBreakDurationMinutes,
    slotCount: value.slotCount,
  }).ok;
}

/**
 * The academic day: four fields and the day they generate.
 *
 * Extracted from the old onboarding screen because there are now two places
 * that ask for it — the second step of creating a timetable, and editing the
 * timetable that already exists — and they differ only in what pressing
 * Continue means. Two copies of a live preview is two chances for them to
 * disagree about what "seven periods" produces.
 *
 * The preview is the fields' *result*, drawn in the same hairline rows as the
 * fields themselves rather than in a bordered box: at eight periods a box was
 * the largest thing on the screen and read as another control.
 */
export function AcademicDayFields({ value, onChange }: AcademicDayFieldsProps) {
  const { colors, spacing, typography, borderWidth } = useTheme();
  const { t } = useI18n();
  const [startTimePickerOpen, setStartTimePickerOpen] = useState(false);

  const preview = useMemo(
    () =>
      generateTimeSlots({
        dayStart: value.academicDayStart,
        lessonDurationMinutes: value.defaultLessonDurationMinutes,
        breakDurationMinutes: value.defaultBreakDurationMinutes,
        slotCount: value.slotCount,
      }),
    [value],
  );

  return (
    <>
      <FormSection>
        <InlineTimeField
          label={t("onboarding.dayStart")}
          value={value.academicDayStart}
          onChange={(academicDayStart) => onChange({ ...value, academicDayStart })}
          expanded={startTimePickerOpen}
          onToggle={() => setStartTimePickerOpen((open) => !open)}
        />
        <DurationField
          label={t("onboarding.lessonDuration")}
          valueMinutes={value.defaultLessonDurationMinutes}
          onChange={(defaultLessonDurationMinutes) => onChange({ ...value, defaultLessonDurationMinutes })}
          minimumMinutes={5}
        />
        <DurationField
          label={t("onboarding.breakDuration")}
          valueMinutes={value.defaultBreakDurationMinutes}
          onChange={(defaultBreakDurationMinutes) => onChange({ ...value, defaultBreakDurationMinutes })}
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
          value={value.slotCount}
          minimum={1}
          maximum={MAX_SLOT_COUNT}
          onChange={(slotCount) => onChange({ ...value, slotCount })}
        />
      </FormSection>

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
    </>
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
