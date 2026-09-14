import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ScreenContainer } from "@/components/ScreenContainer";
import { ScreenHeader } from "@/components/ScreenHeader";
import { AcademicDayFields, isUsableAcademicDay } from "@/features/timetables/AcademicDayFields";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppState, type AcademicDayConfigInput } from "@/state/AppStateContext";
import { useTheme } from "@/theme/useTheme";

/**
 * The academic day of the timetable that already exists.
 *
 * The same fields and the same live preview as the second step of creating a
 * timetable — they share `AcademicDayFields` — and exactly one difference,
 * which is what pressing the button means. Here it regenerates every period,
 * and because placements are addressed by period id, that removes the classes
 * standing on the old ones. So it asks first, and only when there is something
 * to lose.
 *
 * Reached from the current timetable's own screen, which is the single place
 * that owns the timetable's shape. It is deliberately no longer a row in
 * Settings: the academic day was the one thing in there that was a property of
 * the timetable rather than of the app, and having both doors meant two
 * answers to "where do I change this".
 */
export default function AcademicDayScreen() {
  const { colors, spacing, typography } = useTheme();
  const { t } = useI18n();
  const { state, setAcademicDayConfig } = useAppState();

  const [academicDay, setAcademicDay] = useState<AcademicDayConfigInput>({
    academicDayStart: state.settings.academicDayStart,
    defaultLessonDurationMinutes: state.settings.defaultLessonDurationMinutes,
    defaultBreakDurationMinutes: state.settings.defaultBreakDurationMinutes,
    slotCount: state.settings.slotCount,
  });

  const hasActivePlacements = state.placements.some((placement) => !placement.deletedAt);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function save() {
    setConfirmOpen(false);
    const result = setAcademicDayConfig(academicDay);
    if (!result.ok) return;
    router.back();
  }

  function handleSave() {
    if (!isUsableAcademicDay(academicDay)) return;
    if (hasActivePlacements) {
      setConfirmOpen(true);
      return;
    }
    save();
  }

  return (
    <View style={{ flex: 1 }}>
    <ScreenContainer
      header={
        // Save in the header's trailing slot, where the current timetable's
        // screen one step back has it — not as a button at the foot of the form.
        <ScreenHeader
          title={t("timetables.academicDay")}
          onBack={() => router.back()}
          accessibilityBackLabel={t("common.back")}
          action={{
            label: t("common.save"),
            onPress: handleSave,
            emphasis: true,
            disabled: !isUsableAcademicDay(academicDay),
          }}
        />
      }
    >
      <Text style={[typography.body, { color: colors.textSecondary, marginTop: spacing.xs }]}>
        {t("onboarding.academicDaySubtitle")}
      </Text>

      <AcademicDayFields value={academicDay} onChange={setAcademicDay} />
    </ScreenContainer>

      {/* The same themed confirmation the rest of the app asks its serious
          questions with, and it belongs here more than anywhere: this is the
          one screen that deletes every class in the timetable, and the setup
          flow next door already asked its milder version of this question
          through `ConfirmDialog`. A grey platform alert at exactly this
          moment was the app looking least like itself. Destructive in tone —
          the periods the classes stand on are regenerated, and nothing brings
          them back. */}
      {confirmOpen ? (
        <ConfirmDialog
          destructive
          title={t("onboarding.regenerateTitle")}
          message={t("onboarding.regenerateMessage")}
          confirmLabel={t("common.continue")}
          onConfirm={save}
          onCancel={() => setConfirmOpen(false)}
        />
      ) : null}
    </View>
  );
}
