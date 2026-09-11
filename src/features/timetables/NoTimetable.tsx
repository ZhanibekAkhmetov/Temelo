import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

import { Button } from "@/components/Button";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppState } from "@/state/AppStateContext";
import { useTheme } from "@/theme/useTheme";

/**
 * What the app shows when there is no active timetable.
 *
 * This state is reachable in exactly one way — the user archived their only
 * timetable — and the grid must not be what they see next. An empty seven-day
 * grid with periods drawn on it reads as a timetable that lost its classes,
 * which is the opposite of what happened and the most alarming possible way to
 * say "that worked".
 *
 * Two offers, in the order the situation calls for. Create is primary because
 * the usual reason to archive a timetable is that a new term is starting;
 * Archived is secondary, and only there when there is actually something in
 * it — a button leading to an empty list is worse than no button.
 *
 * Deliberately words rather than an illustration: nothing has gone wrong, and
 * a full-screen graphic would make a two-tap situation look like an incident.
 */
export function NoTimetable() {
  const { colors, spacing, typography } = useTheme();
  const { t } = useI18n();
  const { archivedCount } = useAppState();

  return (
    <View style={[styles.container, { padding: spacing.xl, gap: spacing.md }]}>
      <Text style={[typography.title, styles.centered, { color: colors.textPrimary }]}>
        {t("timetables.noCurrent")}
      </Text>
      <Text
        style={[typography.body, styles.centered, { color: colors.textSecondary, marginBottom: spacing.md }]}
      >
        {t("timetables.noCurrentHint")}
      </Text>

      <View style={[styles.actions, { gap: spacing.sm }]}>
        <Button
          label={t("timetables.createNew")}
          variant="primary"
          onPress={() => router.push("/timetables/new-timetable")}
        />
        {archivedCount > 0 ? (
          <Button
            label={t("timetables.title")}
            variant="secondary"
            onPress={() => router.push("/timetables")}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  centered: {
    textAlign: "center",
  },
  actions: {
    alignSelf: "stretch",
    maxWidth: 320,
    width: "100%",
  },
});
