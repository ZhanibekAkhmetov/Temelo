import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FieldRow, FieldValue } from "@/components/FieldRow";
import { FormSection } from "@/components/FormSection";
import { ScreenContainer } from "@/components/ScreenContainer";
import { ScreenHeader } from "@/components/ScreenHeader";
import { TextField } from "@/components/TextField";
import type { DomainError } from "@/domain/errors";
import { CalendarExportSheet } from "@/features/timetables/CalendarExportSheet";
import { daysLabel, hoursLabel } from "@/features/timetables/summary";
import { TimetableActionSheet } from "@/features/timetables/TimetableActionSheet";
import { useExportCalendar, useShareTimetable } from "@/features/timetables/transfer";
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
 * What it shows about the timetable is when it starts, the same one-line shape
 * the list shows — the days it covers and the hours its day runs — and the day
 * it was archived. Not its id, not the snapshot format, not how many classes are in
 * it. The user archived it; they know what is in it, and a row reading
 * "34 records" would be the app talking about itself.
 *
 * Both confirmations are Temelo's own `ConfirmDialog`, and a failure is said
 * on this screen under the buttons rather than in a platform alert.
 */
export default function ArchivedTimetableScreen() {
  const { colors, spacing, typography, borderWidth } = useTheme();
  const { t, format } = useI18n();
  const { state, readArchivedTimetables, restoreTimetable, renameArchive, deleteArchive } = useAppState();
  const params = useLocalSearchParams<{ id?: string; imported?: string }>();
  const archiveId = typeof params.id === "string" ? params.id : "";
  /*
   * Set only by the import flow, which navigates straight here so the user can
   * see where their file landed. A route parameter rather than state, because
   * the thing it is about happened on the previous screen — and it survives the
   * focus re-read below, which would discard anything held here.
   */
  const justImported = params.imported === "1";
  const sharing = useShareTimetable();
  const calendar = useExportCalendar();

  const [entry, setEntry] = useState<ArchivedTimetableSummary | null | undefined>(undefined);
  const [name, setName] = useState<string | null>(null);
  const [nameError, setNameError] = useState<DomainError | undefined>();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<"restore" | "delete" | null>(null);
  /** The Share / Export chooser, and the calendar range sheet it can open. */
  const [transferOpen, setTransferOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  /** Why the last restore or delete did not happen. */
  const [actionError, setActionError] = useState<DomainError | undefined>();

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
  const current = state.timetable;

  async function handleRename() {
    const result = await renameArchive(archiveId, name ?? "");
    if (!result.ok) {
      setNameError(result.error);
      return;
    }
    router.back();
  }

  function handleRestore() {
    // With nothing active there is nothing to weigh up, so the restore just
    // happens. The confirmation exists to explain what becomes of the
    // timetable the user is using — and when there is none, it would be a
    // dialog that says nothing.
    if (!current) {
      void runRestore();
      return;
    }
    setConfirming("restore");
  }

  async function runRestore() {
    setConfirming(null);
    setActionError(undefined);
    setBusy(true);
    const result = await restoreTimetable(archiveId);
    setBusy(false);

    /*
     * A failure leaves the user exactly where they are, with the reason. The
     * previous timetable is still active and still intact — that is what the
     * atomic swap guarantees — so there is nothing to navigate away from.
     */
    if (!result.ok) {
      setActionError(result.error);
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

  async function runDelete() {
    setConfirming(null);
    setActionError(undefined);
    setBusy(true);
    const result = await deleteArchive(archiveId);
    setBusy(false);
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    router.back();
  }

  return (
    <View style={{ flex: 1 }}>
      <ScreenContainer header={header}>
        {/* Arriving straight from an import, the first thing on the screen says
            so — and says what to do next, because the timetable is here but is
            not in use, which is the one thing a user could mistake for the
            import having half worked. */}
        {justImported ? (
          <Text style={[typography.body, { color: colors.accentStrong, marginBottom: spacing.sm }]}>
            {t("transfer.importedNotice")}
          </Text>
        ) : null}

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
              {/* Read-only here: an archive is a record of the timetable as it
                  was put away. Restore it to change when it starts. */}
              <FieldRow label={t("timetables.startsOn")}>
                <FieldValue muted>{format.dateLong(contents.startDate)}</FieldValue>
              </FieldRow>
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

        {/* Sharing or exporting an archive is reading it, so both are offered
            whatever else is on the screen — including for a snapshot too damaged
            to restore, where the attempt simply reports that it could not be
            read. Neither restores anything and neither writes: an archive is
            exported from its own stored snapshot, exactly where it sits. It is
            above the divider because it changes nothing; Delete is below it,
            alone, because it cannot be taken back. */}
        <View style={{ marginTop: spacing.lg }}>
          <Button
            label={t("transfer.shareOrExport")}
            variant="secondary"
            onPress={() => setTransferOpen(true)}
            disabled={busy || sharing.sharing || calendar.exporting}
          />
          {sharing.error ? (
            <Text style={[typography.caption, { color: colors.danger, marginTop: spacing.sm }]}>
              {t(sharing.error.key, sharing.error.params)}
            </Text>
          ) : null}
        </View>

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
            onPress={() => setConfirming("delete")}
            disabled={busy}
          />
        </View>

        {actionError ? (
          <Text style={[typography.caption, { color: colors.danger, marginTop: spacing.md }]}>
            {t(actionError.key, actionError.params)}
          </Text>
        ) : null}

        <View style={{ height: spacing.xl }} />
      </ScreenContainer>

      {transferOpen ? (
        <TimetableActionSheet
          name={entry.name}
          actions={[
            {
              key: "share",
              label: t("transfer.shareFileAction"),
              description: t("transfer.shareFileHint"),
              onPress: () => {
                setTransferOpen(false);
                sharing.shareArchive(archiveId);
              },
            },
            {
              key: "calendar",
              label: t("calendarExport.action"),
              description: t("calendarExport.actionHint"),
              onPress: () => {
                setTransferOpen(false);
                setCalendarOpen(true);
              },
            },
          ]}
          onDismiss={() => setTransferOpen(false)}
        />
      ) : null}

      {/* Only with readable contents: the suggested range is derived from the
          archive's start date, and a snapshot that cannot be read has none to
          derive it from. The chooser above still offers Share, which reports
          the damage itself. */}
      {calendarOpen && contents ? (
        <CalendarExportSheet
          name={entry.name}
          anchorDate={contents.startDate}
          // An archive is history: today is almost certainly past the end of it,
          // so the range starts where the timetable itself did.
          today={null}
          busy={calendar.exporting}
          onExport={(range, how) => calendar.exportArchive(archiveId, range, how)}
          onDismiss={() => setCalendarOpen(false)}
        />
      ) : null}

      {confirming === "restore" && current ? (
        <ConfirmDialog
          title={t("timetables.restoreTitle", { name: entry.name })}
          message={t("timetables.restoreMessage", { current: current.name })}
          confirmLabel={t("timetables.restoreConfirm")}
          onConfirm={() => void runRestore()}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
      {confirming === "delete" ? (
        <ConfirmDialog
          destructive
          title={t("timetables.deleteTitle", { name: entry.name })}
          message={t("timetables.deleteMessage")}
          confirmLabel={t("timetables.deleteConfirm")}
          onConfirm={() => void runDelete()}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
    </View>
  );
}
