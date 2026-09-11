import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { router } from "expo-router";

import { Button } from "@/components/Button";
import { ChoiceRowField } from "@/components/ChoiceRowField";
import { FormSection, NavigationRow } from "@/components/FormSection";
import { ScreenContainer } from "@/components/ScreenContainer";
import { ScreenHeader } from "@/components/ScreenHeader";
import { TextField } from "@/components/TextField";
import type { DomainError } from "@/domain/errors";
import { ALL_WEEKEND_MODES } from "@/domain/week";
import { hoursLabel, shapeOfActive } from "@/features/timetables/summary";
import { useI18n } from "@/i18n/I18nProvider";
import { WEEKEND_MODE_LABEL_KEY } from "@/i18n/weekendMode";
import { useAppState } from "@/state/AppStateContext";
import { MAX_TIMETABLE_NAME_LENGTH } from "@/storage/timetableLifecycle";
import { useTheme } from "@/theme/useTheme";

/**
 * The current timetable.
 *
 * Four things: its name, what it looks like, a way into the academic day, and
 * Archive. Nothing else — no id, no created date, no class count. Those are
 * facts about a database row, and this screen is about a timetable.
 *
 * The name is editable in place and saved with the header's Save, because a
 * rename is a one-field form and a row that opened a second screen to change
 * one string would be a screen too many. Archive is a button below the fields
 * and behind a confirmation, because it is the one action here with a
 * consequence, and the confirmation has to say what the consequence actually
 * is — which is much less alarming than the word "archive" sounds, and saying
 * so is the point.
 */
export default function CurrentTimetableScreen() {
  const { colors, spacing, typography, borderWidth } = useTheme();
  const { t } = useI18n();
  const { state, renameActiveTimetable, archiveCurrentTimetable, setWeekendMode } = useAppState();

  const { timetable } = state;
  const [name, setName] = useState(timetable?.name ?? "");
  const [nameError, setNameError] = useState<DomainError | undefined>();
  const [busy, setBusy] = useState(false);

  /*
   * Archiving from this very screen is what removes the active timetable, and
   * the screen it leaves behind would have nothing to show. So it is dismissed
   * on the way out and this branch only ever renders for the frame between the
   * state change and the navigation.
   */
  if (!timetable) {
    return (
      <ScreenContainer
        header={
          <ScreenHeader
            title={t("timetables.detailsTitle")}
            onBack={() => router.back()}
            accessibilityBackLabel={t("common.back")}
          />
        }
      >
        <Text style={[typography.body, { color: colors.textSecondary, marginTop: spacing.lg }]}>
          {t("timetables.noCurrent")}
        </Text>
      </ScreenContainer>
    );
  }

  const shape = shapeOfActive(state.settings.weekendMode, state.timeSlots);
  const hours = hoursLabel(t, shape);
  // Read out here rather than inside the handler: narrowing a `const` does not
  // reach into a hoisted function declaration, and an assertion would be a
  // worse answer than a name.
  const currentName = timetable.name;

  function handleSave() {
    const result = renameActiveTimetable({ name });
    if (!result.ok) {
      setNameError(result.error);
      return;
    }
    router.back();
  }

  function handleArchive() {
    Alert.alert(
      t("timetables.archiveTitle"),
      t("timetables.archiveMessage", { name: currentName }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("timetables.archiveConfirm"),
          style: "destructive",
          onPress: () => {
            setBusy(true);
            void archiveCurrentTimetable().then((result) => {
              setBusy(false);
              if (!result.ok) {
                Alert.alert(t("timetables.archiveAction"), t(result.error.key, result.error.params));
                return;
              }
              /*
               * Back to the Timetables screen rather than all the way out: the
               * timetable is now in the Archived list right there, which is
               * the only reassurance that matters after pressing Archive.
               */
              router.back();
            });
          },
        },
      ],
    );
  }

  return (
    <ScreenContainer
      header={
        <ScreenHeader
          title={t("timetables.detailsTitle")}
          onBack={() => router.back()}
          accessibilityBackLabel={t("common.back")}
          action={{ label: t("common.save"), onPress: handleSave, emphasis: true }}
        />
      }
    >
      <FormSection>
        <TextField
          label={t("timetables.name")}
          value={name}
          onChangeText={(next) => {
            setName(next);
            setNameError(undefined);
          }}
          placeholder={t("onboarding.timetableNamePlaceholder")}
          error={nameError ? t(nameError.key, nameError.params) : undefined}
          maxLength={MAX_TIMETABLE_NAME_LENGTH}
        />
        {/* Which days this timetable has classes on is edited here and only
            here. It is a single choice, so it commits on tap, the way every
            other single choice in the app does. */}
        <ChoiceRowField
          label={t("timetables.days")}
          value={state.settings.weekendMode}
          options={ALL_WEEKEND_MODES.map((mode) => ({ value: mode, label: t(WEEKEND_MODE_LABEL_KEY[mode]) }))}
          onChange={(weekendMode) => setWeekendMode({ weekendMode })}
          sheetTitle={t("settings.daysWithoutClasses")}
        />
        {/* A whole form, so a row that opens one — and it says what it holds,
            so this screen answers the question without being opened. */}
        <NavigationRow
          label={t("timetables.academicDay")}
          value={hours ?? undefined}
          onPress={() => router.push("/timetables/academic-day")}
        />
      </FormSection>

      <View
        style={{
          marginTop: spacing.xl,
          borderTopWidth: borderWidth.thin,
          borderColor: colors.divider,
          paddingTop: spacing.lg,
        }}
      >
        <Button
          label={t("timetables.archiveAction")}
          variant="destructive"
          onPress={handleArchive}
          disabled={busy}
        />
      </View>

      <View style={{ height: spacing.xl }} />
    </ScreenContainer>
  );
}
