import { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";

import { Button } from "@/components/Button";
import { FormSection, ListRow } from "@/components/FormSection";
import { ScreenContainer } from "@/components/ScreenContainer";
import { ScreenHeader } from "@/components/ScreenHeader";
import { timetableSummary, shapeOfActive } from "@/features/timetables/summary";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppState } from "@/state/AppStateContext";
import type { ArchivedTimetableSummary } from "@/storage/timetableLifecycle";
import { useTheme } from "@/theme/useTheme";

/**
 * Timetables.
 *
 * One Current section, one primary action, and the archived timetables as
 * quiet rows — the same hairline list language as Settings, because that is
 * what this is: a short list of things you can open.
 *
 * What it deliberately is not: cards, a dashboard, or a row of small icon
 * buttons per timetable. Archive, restore and delete are three different
 * decisions with three different consequences, and putting all three within a
 * thumb's width of each other on a list row is how a user deletes a term's
 * worth of classes by accident. Every one of them lives behind the row, on the
 * timetable's own screen, where there is room to say what it does.
 */
export default function TimetablesScreen() {
  const { colors, spacing, typography } = useTheme();
  const { t, format } = useI18n();
  const { state, readArchivedTimetables } = useAppState();
  const [archived, setArchived] = useState<ArchivedTimetableSummary[] | null>(null);

  /*
   * Re-read on focus rather than once on mount.
   *
   * The archived timetables are not in app state — see the note in
   * `AppStateProvider` — so this screen is the one that has to notice when
   * coming back from the details screen has renamed, deleted or restored one.
   * Focus is exactly that moment.
   */
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void readArchivedTimetables().then((list) => {
        if (!cancelled) setArchived(list);
      });
      return () => {
        cancelled = true;
      };
    }, [readArchivedTimetables]),
  );

  const current = state.timetable;
  const currentSummary = current
    ? timetableSummary(t, format, shapeOfActive(state.settings.weekendMode, state.timeSlots))
    : null;

  const archivedCount = archived?.length ?? 0;

  return (
    <ScreenContainer
      header={
        <ScreenHeader
          title={t("timetables.title")}
          onBack={() => router.back()}
          accessibilityBackLabel={t("common.back")}
        />
      }
    >
      {/*
        The heading says what the row below it *is*, not what section of
        settings this is. With one timetable and no archives the screen has to
        answer three questions on its own — which timetable is active, that
        tapping it manages it, and that another can be made — and a heading
        reading "Current" over a row that looked like a settings value answered
        none of them.
      */}
      <FormSection title={t("timetables.sectionCurrent")}>
        {current ? (
          <ListRow
            title={current.name}
            subtitle={currentSummary ?? undefined}
            onPress={() => router.push("/timetables/current")}
            last
          />
        ) : (
          <View style={{ paddingVertical: spacing.md }}>
            <Text style={[typography.body, { color: colors.textPrimary }]}>{t("timetables.noCurrent")}</Text>
            <Text style={[typography.caption, { color: colors.textMuted, marginTop: spacing.xs }]}>
              {t("timetables.noCurrentHint")}
            </Text>
          </View>
        )}
      </FormSection>

      {/* The one primary action on the screen, directly under the timetable it
          would replace — which is also where the explanation of what happens to
          that timetable lives, on the next screen. */}
      <View style={{ marginTop: spacing.lg }}>
        <Button
          label={t("timetables.createNew")}
          variant="primary"
          onPress={() => router.push("/timetables/new-timetable")}
        />
      </View>

      <FormSection
        title={
          archivedCount > 0
            ? t("timetables.sectionArchivedCount", { count: archivedCount })
            : t("timetables.sectionArchived")
        }
      >
        {/* A quiet line rather than an illustration. Having archived nothing
            is not an event, and a big empty state would make the screen look
            like it was waiting for something. */}
        {archived === null ? null : archivedCount === 0 ? (
          <Text style={[typography.caption, styles.empty, { color: colors.textMuted }]}>
            {t("timetables.archivedEmpty")}
          </Text>
        ) : (
          // The same row as the current timetable's, so the list reads as one
          // list of timetables rather than two kinds of thing.
          archived.map((entry, index) => (
            <ListRow
              key={entry.id}
              title={entry.name}
              subtitle={t("timetables.archivedOn", { date: format.dateLong(entry.archivedAt.slice(0, 10)) })}
              onPress={() => router.push({ pathname: "/timetables/archived", params: { id: entry.id } })}
              last={index === archived.length - 1}
            />
          ))
        )}
      </FormSection>

      <View style={{ height: spacing.xl }} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  empty: {
    paddingVertical: 12,
  },
});
