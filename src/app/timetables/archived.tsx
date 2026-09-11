import { useCallback, useState } from "react";
import { Alert, Text, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { Button } from "@/components/Button";
import { FieldRow, FieldValue } from "@/components/FieldRow";
import { FormSection } from "@/components/FormSection";
import { ScreenContainer } from "@/components/ScreenContainer";
import { ScreenHeader } from "@/components/ScreenHeader";
import { TextField } from "@/components/TextField";
import type { DomainError } from "@/domain/errors";
import { daysLabel, hoursLabel } from "@/features/timetables/summary";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppState } from "@/state/AppStateContext";
import { MAX_TIMETABLE_NAME_LENGTH, type ArchivedTimetableSummary } from "@/storage/timetableLifecycle";
import { useTheme } from "@/theme/useTheme";

/**
 * One archived timetable.
 *
 * Restore is the primary action and the reason the screen exists; renaming and
 * deleting are below it, in that order, with Delete last because it is the one
 * that cannot be taken back.
 *
 * What it shows about the timetable is the same one-line shape the list shows
 * — the days it covers and the hours its day runs — and the day it was
 * archived. Not its id, not the snapshot format, not how many classes are in
 * it. The user archived it; they know what is in it, and a row reading
 * "34 records" would be the app talking about itself.
 */
export default function ArchivedTimetableScreen() {
  const { colors, spacing, typography, borderWidth } = useTheme();
  const { t, format } = useI18n();
  const { state, readArchivedTimetables, restoreTimetable, renameArchive, deleteArchive } = useAppState();
  const params = useLocalSearchParams<{ id?: string }>();
  const archiveId = typeof params.id === "string" ? params.id : "";

  const [entry, setEntry] = useState<ArchivedTimetableSummary | null | undefined>(undefined);
  const [name, setName] = useState<string | null>(null);
  const [nameError, setNameError] = useState<DomainError | undefined>();
  const [busy, setBusy] = useState(false);

  /*
   * Read on focus, from the list rather than from app state: archived
   * timetables are not held in memory, and this screen is reached from a list
   * that may be out of date by the time it renders.
   *
   * `undefined` is "not read yet" and `null` is "not there", which are
   * different screens — the second is what a user sees if the archive was
   * deleted from another device or, more realistically, if they pressed the
   * row twice.
   */
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void readArchivedTimetables().then((list) => {
        if (cancelled) return;
        const found = list.find((candidate) => candidate.id === archiveId) ?? null;
        setEntry(found);
        // Only seeded once, so a re-focus does not discard what is being typed.
        setName((current) => current ?? found?.name ?? "");
      });
      return () => {
        cancelled = true;
      };
    }, [readArchivedTimetables, archiveId]),
  );

  const header = (
    <ScreenHeader
      title={entry?.name ?? t("timetables.detailsTitle")}
      onBack={() => router.back()}
      accessibilityBackLabel={t("common.back")}
      action={
        entry
          ? { label: t("common.save"), onPress: () => void handleRename(), emphasis: true }
          : undefined
      }
    />
  );

  if (entry === undefined) return <ScreenContainer header={header}>{null}</ScreenContainer>;

  if (entry === null) {
    return (
      <ScreenContainer header={header}>
        <Text style={[typography.body, { color: colors.textSecondary, marginTop: spacing.lg }]}>
          {t("errors.archiveGone")}
        </Text>
      </ScreenContainer>
    );
  }

  const contents = entry.contents;
  const hours = contents ? hoursLabel(t, contents) : null;

  async function handleRename() {
    const result = await renameArchive(archiveId, name ?? "");
    if (!result.ok) {
      setNameError(result.error);
      return;
    }
    router.back();
  }

  function handleRestore() {
    const current = state.timetable;
    // With nothing active there is nothing to weigh up, so the restore just
    // happens. The confirmation exists to explain what becomes of the
    // timetable the user is using — and when there is none, it would be a
    // dialog that says nothing.
    if (!current) {
      void runRestore();
      return;
    }

    Alert.alert(
      t("timetables.restoreTitle", { name: entry!.name }),
      t("timetables.restoreMessage", { current: current.name }),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("timetables.restoreConfirm"), onPress: () => void runRestore() },
      ],
    );
  }

  async function runRestore() {
    setBusy(true);
    const result = await restoreTimetable(archiveId);
    setBusy(false);

    /*
     * A failure leaves the user exactly where they are, with the reason. The
     * previous timetable is still active and still intact — that is what the
     * atomic swap guarantees — so there is nothing to navigate away from.
     */
    if (!result.ok) {
      Alert.alert(t("timetables.restoreAction"), t(result.error.key, result.error.params));
      return;
    }

    /*
     * Success: out of the management screens altogether and onto the grid.
     *
     * This screen is now about a timetable that is no longer archived, and the
     * two screens behind it are a list and a settings page. What the user
     * actually asked for was to use this timetable, and leaving them three
     * Backs away from seeing it made a successful restore feel like it had not
     * happened. The navigation runs only here, after the transaction has
     * committed and the state has been read back from the database.
     */
    router.dismissAll();
    router.replace("/timetable");
  }

  function handleDelete() {
    Alert.alert(t("timetables.deleteTitle", { name: entry!.name }), t("timetables.deleteMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("timetables.deleteConfirm"),
        style: "destructive",
        onPress: () => {
          setBusy(true);
          void deleteArchive(archiveId).then((result) => {
            setBusy(false);
            if (!result.ok) {
              Alert.alert(t("timetables.deleteAction"), t(result.error.key, result.error.params));
              return;
            }
            router.back();
          });
        },
      },
    ]);
  }

  return (
    <ScreenContainer header={header}>
      {/* When it was archived, as a line rather than a row: it is context for
          everything below, not one of the things this screen can change. */}
      <Text style={[typography.caption, { color: colors.textMuted }]}>
        {t("timetables.archivedOn", { date: format.dateLong(entry.archivedAt.slice(0, 10)) })}
      </Text>

      <FormSection>
        <TextField
          label={t("timetables.name")}
          value={name ?? ""}
          onChangeText={(next) => {
            setName(next);
            setNameError(undefined);
          }}
          placeholder={t("timetables.renamePrompt")}
          error={nameError ? t(nameError.key, nameError.params) : undefined}
          maxLength={MAX_TIMETABLE_NAME_LENGTH}
        />
        {contents ? (
          <>
            <FieldRow label={t("timetables.days")}>
              <FieldValue muted>{daysLabel(t, format, contents.weekendMode)}</FieldValue>
            </FieldRow>
            {hours ? (
              <FieldRow label={t("timetables.academicDay")} last>
                <FieldValue muted>{hours}</FieldValue>
              </FieldRow>
            ) : null}
          </>
        ) : null}
      </FormSection>

      {/* A damaged snapshot is still a row the user can name and remove; it is
          only restoring that is impossible, and the button says so by not
          being there rather than by failing when pressed. */}
      {contents ? (
        <View style={{ marginTop: spacing.lg }}>
          <Button
            label={t("timetables.restoreAction")}
            variant="primary"
            onPress={handleRestore}
            disabled={busy}
          />
        </View>
      ) : (
        <Text style={[typography.caption, { color: colors.danger, marginTop: spacing.lg }]}>
          {t("timetables.damaged")}
        </Text>
      )}

      <View
        style={{
          marginTop: spacing.xl,
          borderTopWidth: borderWidth.thin,
          borderColor: colors.divider,
          paddingTop: spacing.lg,
        }}
      >
        <Button
          label={t("timetables.deleteAction")}
          variant="destructive"
          onPress={handleDelete}
          disabled={busy}
        />
      </View>

      <View style={{ height: spacing.xl }} />
    </ScreenContainer>
  );
}
