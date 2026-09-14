import { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";

import { Button } from "@/components/Button";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FormSection, ListGroup } from "@/components/FormSection";
import { ScreenContainer } from "@/components/ScreenContainer";
import { ScreenHeader } from "@/components/ScreenHeader";
import { todayIsoDate } from "@/domain/date";
import { CalendarExportSheet } from "@/features/timetables/CalendarExportSheet";
import { ImportPreviewDialog } from "@/features/timetables/ImportPreviewDialog";
import { TimetableActionSheet, type TimetableAction } from "@/features/timetables/TimetableActionSheet";
import { timetableSummary, shapeOfActive } from "@/features/timetables/summary";
import { TimetableSummaryRow } from "@/features/timetables/TimetableSummaryRow";
import { useExportCalendar, useImportTimetable, useShareTimetable } from "@/features/timetables/transfer";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppState } from "@/state/AppStateContext";
import type { ArchivedTimetableSummary } from "@/storage/timetableLifecycle";
import { useTheme } from "@/theme/useTheme";
import { activationTick } from "@/util/haptics";

/**
 * Timetables.
 *
 * The current timetable on a surface of its own, the two things you can do next
 * under it, and the archived timetables on one shared surface below — a list of
 * things you open, drawn as one. Every row is a single full-width target with a
 * chevron; tapping it opens that timetable's own screen, which is where archive,
 * restore and delete live with room to say what they do.
 *
 * What it deliberately is not: a dashboard, a card per timetable, statistics,
 * or a row of small icon buttons per timetable. Archive, restore and delete are
 * three different decisions with three different consequences, and putting all
 * three within a thumb's width of each other on a list row is how a user
 * deletes a term's worth of classes by accident.
 *
 * ## The two actions under the current timetable
 *
 * Create is the primary one and stays where it was — directly under the
 * timetable it would replace, which is also where the explanation of what
 * happens to that timetable lives, on the next screen.
 *
 * Import is beside it and quieter, because it is the rarer of the two by a long
 * way and because it is the same *kind* of thing: both end in one more
 * timetable existing. A secondary button rather than a row or a header icon —
 * it has to be findable by somebody who has just been sent a file and has no
 * idea Temelo can read it, and neither of those is.
 *
 * ## The long press
 *
 * A long press on any row selects it and offers what can be done to that
 * timetable from here: Share for the current one, Share and Delete for an
 * archived one. It is a shortcut and never the only route — every action in it
 * is also a button on the timetable's own screen — so the gesture can be missed
 * entirely without anything becoming unreachable. See `TimetableActionSheet`.
 */
export default function TimetablesScreen() {
  const { colors, spacing, typography } = useTheme();
  const { t, format } = useI18n();
  const { state, readArchivedTimetables, deleteArchive } = useAppState();
  const [archived, setArchived] = useState<ArchivedTimetableSummary[] | null>(null);

  const sharing = useShareTimetable();
  const importing = useImportTimetable();
  const calendar = useExportCalendar();

  /**
   * Which row the contextual actions are about, or null.
   *
   * Exactly one, by construction — this is a selected row, not a selection
   * mode. See the note in `TimetableActionSheet` about why Beta 1 has no
   * multi-select.
   */
  const [selected, setSelected] = useState<{ kind: "current" | "archived"; id: string; name: string } | null>(null);
  /** The archived timetable a Delete from the sheet is waiting on. */
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  /**
   * The timetable a calendar export is being ranged for, with the start date
   * the suggested range is derived from.
   *
   * Held here rather than read back off `selected`, because the sheet that
   * produced it is dismissed before this opens — an action sheet and a form
   * stacked on each other would be two scrims deep.
   */
  const [exporting, setExporting] = useState<{
    kind: "current" | "archived";
    id: string;
    name: string;
    anchorDate: string;
  } | null>(null);

  /*
   * Re-read on focus rather than once on mount.
   *
   * The archived timetables are not in app state — see the note in
   * `AppStateProvider` — so this screen is the one that has to notice when
   * coming back from the details screen has renamed, deleted or restored one.
   * Focus is exactly that moment, and it is also what picks up a timetable this
   * screen has just imported.
   */
  const refresh = useCallback(() => {
    void readArchivedTimetables().then(setArchived);
  }, [readArchivedTimetables]);

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
  const busy = sharing.sharing || importing.busy || calendar.exporting;

  function select(kind: "current" | "archived", id: string, name: string) {
    // The same tick a long press on a timetable block gives, for the same
    // reason: the gesture has no visible beginning, so it needs a felt one.
    activationTick();
    setSelected({ kind, id, name });
  }

  /** The start date a row's suggested export range is derived from, or null. */
  function anchorDateFor(entry: NonNullable<typeof selected>): string | null {
    if (entry.kind === "current") return current?.anchorDate ?? null;
    return archived?.find((candidate) => candidate.id === entry.id)?.contents?.startDate ?? null;
  }

  /** What the sheet offers for whichever row is selected. */
  function actionsFor(entry: NonNullable<typeof selected>): TimetableAction[] {
    const share: TimetableAction = {
      key: "share",
      label: t("transfer.shareFileAction"),
      description: t("transfer.shareFileHint"),
      onPress: () => {
        setSelected(null);
        if (entry.kind === "current") sharing.shareActive();
        else sharing.shareArchive(entry.id);
      },
    };

    const anchorDate = anchorDateFor(entry);
    /*
     * Offered only when there is a start date to range from — which for an
     * archive means a snapshot that could be read. A damaged one keeps Share,
     * which reports the damage itself, and simply does not offer this.
     */
    const exportToCalendar: TimetableAction[] =
      anchorDate === null
        ? []
        : [
            {
              key: "calendar",
              label: t("calendarExport.action"),
              description: t("calendarExport.actionHint"),
              onPress: () => {
                setSelected(null);
                setExporting({ kind: entry.kind, id: entry.id, name: entry.name, anchorDate });
              },
            },
          ];

    if (entry.kind === "current") return [share, ...exportToCalendar];

    return [
      share,
      ...exportToCalendar,
      {
        key: "delete",
        label: t("timetables.deleteAction"),
        destructive: true,
        onPress: () => {
          setSelected(null);
          // Never straight from the sheet: the one action here that cannot be
          // taken back goes through the same themed confirmation the archived
          // timetable's own screen uses.
          setDeleting({ id: entry.id, name: entry.name });
        },
      },
    ];
  }

  function handleDelete() {
    const target = deleting;
    if (!target) return;
    setDeleting(null);
    void deleteArchive(target.id).then(() => refresh());
  }

  function handleImportConfirm() {
    void importing.confirm().then((result) => {
      if (!result?.ok) return;
      refresh();
      /*
       * Somewhere the user can see it landed, and which of the two things
       * happened.
       *
       * Into the archive: its own screen, where Restore is the primary button —
       * so the next step, if they want one, is right there. Into an empty app:
       * the grid, because the imported timetable *is* their timetable now and
       * anything short of showing it would read as the import not having
       * worked.
       */
      if (result.destination === "active") {
        router.dismissAll();
        router.replace("/timetable");
        return;
      }
      router.push({
        pathname: "/timetables/archived",
        params: { id: result.timetableId, imported: "1" },
      });
    });
  }

  const transferError = sharing.error ?? (importing.pending ? null : importing.error);

  return (
    <View style={{ flex: 1 }}>
      <ScreenContainer
        header={
          <ScreenHeader
            title={t("timetables.title")}
            onBack={() => router.back()}
            accessibilityBackLabel={t("common.back")}
          />
        }
      >
        <FormSection title={t("timetables.sectionCurrent")}>
          <ListGroup>
            {current ? (
              <TimetableSummaryRow
                grouped
                name={current.name}
                summary={currentSummary ?? undefined}
                status={t("timetables.currentBadge")}
                onPress={() => router.push("/timetables/current")}
                onLongPress={() => select("current", current.id, current.name)}
                selected={selected?.kind === "current"}
                last
              />
            ) : (
              <View style={{ padding: spacing.lg }}>
                <Text style={[typography.body, { color: colors.textPrimary }]}>{t("timetables.noCurrent")}</Text>
                <Text style={[typography.caption, { color: colors.textMuted, marginTop: spacing.xs }]}>
                  {t("timetables.noCurrentHint")}
                </Text>
              </View>
            )}
          </ListGroup>
        </FormSection>

        {/* Create is the primary action and sits directly under the timetable it
            would replace. Import is the same kind of thing — one more timetable
            afterwards — so it belongs here rather than in the header, and it is
            secondary because it is by far the rarer of the two. */}
        <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
          <Button
            label={t("timetables.createNew")}
            variant="primary"
            onPress={() => router.push("/timetables/new-timetable")}
            disabled={busy}
          />
          <Button
            label={t("transfer.importAction")}
            variant="secondary"
            onPress={importing.choose}
            disabled={busy}
          />
          {/* One line, under the button it is about: a `.temelo` can also
              arrive through another app's share sheet, and there is nowhere
              else a user would ever find that out. Deliberately a sentence and
              not a walkthrough — the whole instruction is "tap Share, pick
              Temelo", and anybody who has shared a photo already knows it. */}
          <Text style={[typography.caption, { color: colors.textMuted }]}>{t("transfer.importHint")}</Text>
          {transferError ? (
            <Text style={[typography.caption, { color: colors.danger }]}>
              {t(transferError.key, transferError.params)}
            </Text>
          ) : null}
        </View>

        <FormSection
          title={
            archivedCount > 0
              ? t("timetables.sectionArchivedCount", { count: archivedCount })
              : t("timetables.sectionArchived")
          }
        >
          {/* A quiet line rather than an empty surface or an illustration.
              Having archived nothing is not an event, and a big empty state
              would make the screen look like it was waiting for something. */}
          {archived === null ? null : archivedCount === 0 ? (
            <Text style={[typography.caption, styles.empty, { color: colors.textMuted }]}>
              {t("timetables.archivedEmpty")}
            </Text>
          ) : (
            // The same row as the current timetable's, on one shared surface, so
            // the archive reads as one list of timetables.
            <ListGroup>
              {archived.map((entry, index) => (
                <TimetableSummaryRow
                  key={entry.id}
                  grouped
                  name={entry.name}
                  summary={
                    entry.contents
                      ? timetableSummary(t, format, entry.contents)
                      : t("timetables.archivedOn", { date: format.dateLong(entry.archivedAt.slice(0, 10)) })
                  }
                  onPress={() => router.push({ pathname: "/timetables/archived", params: { id: entry.id } })}
                  onLongPress={() => select("archived", entry.id, entry.name)}
                  selected={selected?.kind === "archived" && selected.id === entry.id}
                  last={index === archived.length - 1}
                />
              ))}
            </ListGroup>
          )}
        </FormSection>

        <View style={{ height: spacing.xl }} />
      </ScreenContainer>

      {selected ? (
        <TimetableActionSheet
          name={selected.name}
          actions={actionsFor(selected)}
          onDismiss={() => setSelected(null)}
        />
      ) : null}

      {exporting ? (
        <CalendarExportSheet
          name={exporting.name}
          anchorDate={exporting.anchorDate}
          // Today for the timetable in use, its own start for an archive; see
          // `defaultCalendarExportRange`.
          today={exporting.kind === "current" ? todayIsoDate() : null}
          busy={calendar.exporting}
          onExport={(range, how) =>
            exporting.kind === "current"
              ? calendar.exportActive(range, how)
              : calendar.exportArchive(exporting.id, range, how)
          }
          onDismiss={() => setExporting(null)}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          destructive
          title={t("timetables.deleteTitle", { name: deleting.name })}
          message={t("timetables.deleteMessage")}
          confirmLabel={t("timetables.deleteConfirm")}
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      ) : null}

      {importing.pending ? (
        <ImportPreviewDialog
          pending={importing.pending}
          busy={importing.busy}
          error={importing.error ? t(importing.error.key, importing.error.params) : undefined}
          onConfirm={handleImportConfirm}
          onCancel={importing.cancel}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    paddingVertical: 12,
  },
});
