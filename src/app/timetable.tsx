import { useCallback, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { addWeeksIso, startOfWeekIso, weeksBetweenIso } from "@/domain/calendar";
import {
  blockedScopeReasons,
  createPendingClassEdit,
  type EditScope,
  type PendingClassEdit,
} from "@/domain/classEdit";
import { addDaysIso } from "@/domain/date";
import { isOnOrAfterTimetableStart } from "@/domain/occurrence";
import { DesktopAboutDialog } from "@/features/desktop/DesktopAboutDialog";
import { DesktopSidebar } from "@/features/desktop/DesktopSidebar";
import { DesktopToolbar } from "@/features/desktop/DesktopToolbar";
import { ClassEditorModal } from "@/features/timetable/ClassEditorModal";
import { EditScopeSheet } from "@/features/timetable/EditScopeSheet";
import { DESKTOP_READABLE_SLOT_HEIGHT } from "@/features/timetable/geometry";
import { SlotClassesSheet } from "@/features/timetable/SlotClassesSheet";
import {
  TimetableSurface,
  type MoveOutcome,
  type OccurrenceMove,
  type OccurrencePosition,
  type PlacementPosition,
  type PlacementStatus,
  type TimetableSurfaceHandle,
} from "@/features/timetable/TimetableSurface";
import { WeekGridHorizontal } from "@/features/timetable/WeekGridHorizontal";
import { NoTimetable } from "@/features/timetables/NoTimetable";
import { useNow } from "@/features/timetable/useNow";
import type { SelectedCell, SlotChoice } from "@/features/timetable/types";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppState, type ActionResult, type MovePlacementInput } from "@/state/AppStateContext";
import { useIsDesktop } from "@/theme/useIsDesktop";
import { useTheme } from "@/theme/useTheme";

/** Thursday names the month a week belongs to when it straddles two. */
const MONTH_LABEL_DAY_OFFSET = 3;

/**
 * An edit that stopped at an overlap, waiting for "Save anyway".
 *
 * It holds exactly what is needed to repeat the same edit with the overlap
 * allowed — the move of a one-off, or a scoped edit whose draft is still the
 * pending one — and nothing has been written while it is open.
 */
type OverlapPrompt =
  | { kind: "move"; name: string; input: MovePlacementInput }
  | { kind: "edit"; name: string; scope: EditScope };

/** A store answer, read as what a drag preview should show. */
function placementStatusOf(result: ActionResult): PlacementStatus {
  if (result.ok) return "free";
  return result.overlapWith ? "overlap" : "blocked";
}

export default function TimetableScreen() {
  const { colors, spacing, typography } = useTheme();
  const { t, format } = useI18n();
  const { state, movePlacement, checkPlacement, checkOccurrence, applyClassEdit } = useAppState();
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  /**
   * An edit that has been made but not yet applied to anything. It is drawn
   * where it would land and lives only here, so cancelling the scope
   * question leaves the stored timetable exactly as it was.
   */
  const [pendingEdit, setPendingEdit] = useState<PendingClassEdit | null>(null);
  const [gridSize, setGridSize] = useState({ width: 0, height: 0 });
  /** A tapped cell holding several classes, asking which one was meant. */
  const [slotChoice, setSlotChoice] = useState<SlotChoice | null>(null);
  const [overlapPrompt, setOverlapPrompt] = useState<OverlapPrompt | null>(null);
  // Desktop only: the sidebar beside the week, and About over it.
  const isDesktop = useIsDesktop();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [aboutOpen, setAboutOpen] = useState(false);

  // The tick is also what carries the timetable over midnight, so the date
  // comes from it rather than from a bare call here: everything below is
  // derived from state and re-read whenever the moment actually changes.
  const now = useNow();
  const today = now.date;
  const currentWeekStart = startOfWeekIso(today);
  const [visibleWeekStart, setVisibleWeekStart] = useState(currentWeekStart);

  const surfaceRef = useRef<TimetableSurfaceHandle>(null);
  // The stored array keeps its identity until the days themselves change, so
  // a minute tick cannot invalidate the memoised pages. Hidden days are a
  // presentation choice: their classes are still in state, still reminded
  // about and still exported — they are only not given a column.
  const weekdays = state.settings.visibleWeekdays;
  const isVertical = state.settings.gridOrientation === "vertical";
  const isOnCurrentWeek = visibleWeekStart === currentWeekStart;

  function goToRelativeWeek(offset: number) {
    if (isVertical) {
      surfaceRef.current?.goToRelativeWeek(offset);
      return;
    }
    setVisibleWeekStart((weekStart) => addWeeksIso(weekStart, offset));
  }

  function goToCurrentWeek() {
    if (isVertical) {
      surfaceRef.current?.goToCurrentWeek();
      return;
    }
    setVisibleWeekStart(currentWeekStart);
  }

  /** The week containing a date picked in the desktop sidebar's month. */
  function goToDate(isoDate: string) {
    goToRelativeWeek(weeksBetweenIso(visibleWeekStart, startOfWeekIso(isoDate)));
  }

  /**
   * A settled drag or resize. A class that meets once has no series to
   * scope against, so it simply moves; anything that repeats is drafted and
   * the scope question is asked before the store hears about it at all.
   */
  const handleMoveClass = useCallback(
    (move: OccurrenceMove): MoveOutcome => {
      const series = move.occurrence.basePlacement;
      if (series.recurrenceType === "once") {
        const input: MovePlacementInput = {
          placementId: series.id,
          weekday: move.weekday,
          timeSlotId: move.timeSlotId,
          slotSpan: move.slotSpan,
          occurrenceDate: move.occurrence.occurrenceDate,
          date: move.date,
        };
        const result = movePlacement(input);
        // Landing on another class is the user's call: ask, and hold the drag
        // where it was dropped until they answer.
        if (!result.ok && result.overlapWith) {
          setOverlapPrompt({ kind: "move", name: result.overlapWith, input });
          return "deferred";
        }
        if (!result.ok) Alert.alert(t("timetable.cannotMove"), t(result.error.key, result.error.params));
        return "committed";
      }

      setPendingEdit(
        createPendingClassEdit({
          occurrence: move.occurrence,
          source: move.source,
          effectiveDate: move.date,
          weekday: move.weekday,
          timeSlotId: move.timeSlotId,
          slotSpan: move.slotSpan,
        }),
      );
      return "deferred";
    },
    [movePlacement, t],
  );

  function handleScopeCancel() {
    setPendingEdit(null);
    surfaceRef.current?.settleDeferredDrag(true);
  }

  function handleScopeSelect(scope: EditScope) {
    if (!pendingEdit) return;
    const result = applyClassEdit(pendingEdit.draft, scope);
    // An overlap keeps the edit pending — still drawn where it would land —
    // and asks before it goes any further.
    if (!result.ok && result.overlapWith) {
      setOverlapPrompt({ kind: "edit", name: result.overlapWith, scope });
      return;
    }
    setPendingEdit(null);
    surfaceRef.current?.settleDeferredDrag(!result.ok);
    if (!result.ok) Alert.alert(t("timetable.cannotApply"), t(result.error.key, result.error.params));
  }

  /** "Save anyway": the same edit again, with the overlap accepted. */
  function handleOverlapConfirm() {
    const prompt = overlapPrompt;
    setOverlapPrompt(null);
    if (!prompt) return;
    if (prompt.kind === "move") {
      const result = movePlacement(prompt.input, { allowOverlap: true });
      surfaceRef.current?.settleDeferredDrag(!result.ok);
      if (!result.ok) Alert.alert(t("timetable.cannotMove"), t(result.error.key, result.error.params));
      return;
    }
    if (!pendingEdit) return;
    const result = applyClassEdit(pendingEdit.draft, prompt.scope, { allowOverlap: true });
    setPendingEdit(null);
    surfaceRef.current?.settleDeferredDrag(!result.ok);
    if (!result.ok) Alert.alert(t("timetable.cannotApply"), t(result.error.key, result.error.params));
  }

  /** Cancel: nothing was written, and a dragged class goes back where it was. */
  function handleOverlapCancel() {
    setOverlapPrompt(null);
    setPendingEdit(null);
    surfaceRef.current?.settleDeferredDrag(true);
  }

  // Asked once per crossed boundary while dragging, so the preview can show
  // whether the drop would be accepted before the finger lifts. Both go to
  // the store, so the answer is the one the commit will give.
  const handleCanPlaceClass = useCallback(
    (input: PlacementPosition) => placementStatusOf(checkPlacement(input)),
    [checkPlacement],
  );
  const handleCanPlaceOccurrence = useCallback(
    (input: OccurrencePosition) => placementStatusOf(checkOccurrence(input)),
    [checkOccurrence],
  );

  /*
   * A new class can only be started on a date the timetable reaches. The weeks
   * before its start are still there to look at, but a class added to one
   * would be saved and then never drawn — so the tap says why, and where the
   * start date is changed, instead of opening an editor that cannot succeed.
   */
  const handleOpenEditor = useCallback(
    (selection: SelectedCell) => {
      const timetable = state.timetable;
      if (!selection.existing && timetable && !isOnOrAfterTimetableStart(selection.date, timetable.anchorDate)) {
        Alert.alert(
          t("timetable.beforeStartTitle"),
          t("timetable.beforeStartMessage", { name: timetable.name, date: format.dateLong(timetable.anchorDate) }),
        );
        return;
      }
      setSelected(selection);
    },
    [format, state.timetable, t],
  );

  const timetable = state.timetable;

  // The week itself — the same element in both layouts. Null with no timetable.
  const grid = timetable ? (
    <View
      style={styles.flex}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setGridSize((previous) => (previous.width === width && previous.height === height ? previous : { width, height }));
      }}
    >
      {isVertical ? (
        <TimetableSurface
          // Re-anchoring at a week boundary is rare and a remount is the
          // simplest way to keep page index 0 meaning "this week".
          key={currentWeekStart}
          ref={surfaceRef}
          anchorWeekStart={currentWeekStart}
          weekdays={weekdays}
          timeSlots={state.timeSlots}
          placements={state.placements}
          courses={state.courses}
          exceptions={state.exceptions}
          preview={pendingEdit?.preview ?? null}
          timetableStart={timetable.anchorDate}
          today={today}
          now={now.time}
          onVisibleWeekChange={setVisibleWeekStart}
          onOpenEditor={handleOpenEditor}
          onOpenSlot={setSlotChoice}
          onMoveClass={handleMoveClass}
          canPlaceClass={handleCanPlaceClass}
          canPlaceOccurrence={handleCanPlaceOccurrence}
          // A desktop window lets the day grow to fill it.
          readableSlotHeight={isDesktop ? DESKTOP_READABLE_SLOT_HEIGHT : undefined}
        />
      ) : gridSize.width === 0 ? null : (
        <WeekGridHorizontal
          weekStart={visibleWeekStart}
          weekdays={weekdays}
          timeSlots={state.timeSlots}
          placements={state.placements}
          courses={state.courses}
          exceptions={state.exceptions}
          preview={pendingEdit?.preview ?? null}
          timetableStart={timetable.anchorDate}
          today={today}
          now={now.time}
          width={gridSize.width}
          height={gridSize.height}
          onCellPress={handleOpenEditor}
          onSlotPress={setSlotChoice}
        />
      )}
    </View>
  ) : null;

  // Everything that opens over the week: the editor, the slot chooser, the
  // overlap question and the scope question.
  const dialogs = timetable ? (
    <>
      {selected ? (
        <ClassEditorModal
          visible
          onClose={() => setSelected(null)}
          weekday={selected.weekday}
          date={selected.date}
          timeSlot={selected.timeSlot}
          slotSpan={selected.slotSpan}
          endTime={selected.endTime}
          timetable={timetable}
          existing={selected.existing}
          onRequestScope={setPendingEdit}
          // The same cell, as a brand-new class: the way to put a second class
          // beside one that is already there.
          onAddAnother={() => setSelected((current) => (current ? { ...current, existing: undefined } : current))}
        />
      ) : null}

      {slotChoice && !selected ? (
        <SlotClassesSheet
          choice={slotChoice}
          onSelect={(selection) => {
            setSlotChoice(null);
            handleOpenEditor(selection);
          }}
          onAdd={(selection) => {
            setSlotChoice(null);
            handleOpenEditor(selection);
          }}
          onCancel={() => setSlotChoice(null)}
        />
      ) : null}

      {overlapPrompt ? (
        <ConfirmDialog
          title={t("overlap.title")}
          message={t("overlap.message", { name: overlapPrompt.name })}
          confirmLabel={t("overlap.saveAnyway")}
          onConfirm={handleOverlapConfirm}
          onCancel={handleOverlapCancel}
        />
      ) : null}

      {/* Never in the same frame as the editor: they are two native modals,
          and the editor's save is what raises this one. */}
      {pendingEdit && !selected && !overlapPrompt ? (
        <EditScopeSheet
          effectiveDate={pendingEdit.draft.effectiveDate}
          blockedReasons={blockedScopeReasons(pendingEdit.draft)}
          onSelect={handleScopeSelect}
          onCancel={handleScopeCancel}
        />
      ) : null}
    </>
  ) : null;

  /*
   * Desktop: a toolbar across the top, the sidebar down the left, the week in
   * the rest. Settings that are one choice live in the sidebar; everything
   * else opens as a dialog over the week (see `useDesktopDialogOptions`).
   */
  if (isDesktop) {
    return (
      <View style={[styles.flex, { backgroundColor: colors.background }]}>
        <DesktopToolbar
          title={format.monthYear(addDaysIso(visibleWeekStart, MONTH_LABEL_DAY_OFFSET))}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
          navigation={
            timetable
              ? { onToday: goToCurrentWeek, onPrevious: () => goToRelativeWeek(-1), onNext: () => goToRelativeWeek(1) }
              : null
          }
        />
        <View style={[styles.flex, styles.row]}>
          {sidebarOpen ? (
            <DesktopSidebar today={today} onSelectDate={goToDate} onOpenAbout={() => setAboutOpen(true)} />
          ) : null}
          <View style={styles.flex}>{grid ?? <NoTimetable />}</View>
        </View>
        {dialogs}
        {aboutOpen ? <DesktopAboutDialog onClose={() => setAboutOpen(false)} /> : null}
      </View>
    );
  }

  /*
   * No active timetable: there is nothing to page through, so the week
   * navigation and the grid are both wrong. The empty state replaces the whole
   * screen rather than filling the grid area, because a month title and a
   * pair of week arrows above "no timetable yet" would be chrome for
   * something that is not there.
   *
   * The menu stays, as the one thing still worth reaching — Settings, and
   * through it everything about timetables.
   */
  if (!timetable) {
    return (
      <SafeAreaView
        style={[styles.flex, { backgroundColor: colors.background }]}
        edges={["top", "left", "right", "bottom"]}
      >
        <View style={[styles.header, { paddingTop: 2, backgroundColor: colors.headerBackground }]}>
          <View style={[styles.headerLeft, { left: spacing.md }]} pointerEvents="box-none">
            <Pressable
              onPress={() => router.push("/settings")}
              accessibilityRole="button"
              accessibilityLabel={t("timetable.openSettings")}
              hitSlop={8}
              pressRetentionOffset={{ top: 20, bottom: 20, left: 20, right: 20 }}
              style={({ pressed }) => [styles.arrowTarget, { opacity: pressed ? 0.5 : 1 }]}
            >
              <Text style={[styles.glyph, { color: colors.textSecondary }]}>≡</Text>
            </Pressable>
          </View>
          <View style={styles.arrowTarget} />
        </View>
        <NoTimetable />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} edges={["top", "left", "right", "bottom"]}>
      {/* The navigation cluster is centred on the screen itself: the menu
          sits in its own absolutely positioned layer so it cannot push the
          month title off centre. */}
      <View style={[styles.header, { paddingTop: 2, backgroundColor: colors.headerBackground }]}>
        <View style={styles.headerCluster}>
          <Pressable
            onPress={() => goToRelativeWeek(-1)}
            accessibilityRole="button"
            accessibilityLabel={t("timetable.previousWeek")}
            style={styles.arrowTarget}
          >
            <Text style={[styles.glyph, { color: colors.textSecondary }]}>‹</Text>
          </Pressable>
          <Text style={[styles.monthTitle, { color: colors.textPrimary }]} numberOfLines={1}>
            {format.monthShortYear(addDaysIso(visibleWeekStart, MONTH_LABEL_DAY_OFFSET))}
          </Text>
          <Pressable
            onPress={() => goToRelativeWeek(1)}
            accessibilityRole="button"
            accessibilityLabel={t("timetable.nextWeek")}
            style={styles.arrowTarget}
          >
            <Text style={[styles.glyph, { color: colors.textSecondary }]}>›</Text>
          </Pressable>
        </View>

        <View style={[styles.headerLeft, { left: spacing.md }]} pointerEvents="box-none">
          <Pressable
            onPress={() => router.push("/settings")}
            accessibilityRole="button"
            accessibilityLabel={t("timetable.openSettings")}
            hitSlop={8}
            pressRetentionOffset={{ top: 20, bottom: 20, left: 20, right: 20 }}
            style={({ pressed }) => [styles.arrowTarget, { opacity: pressed ? 0.5 : 1 }]}
          >
            <Text style={[styles.glyph, { color: colors.textSecondary }]}>≡</Text>
          </Pressable>
        </View>

        <View style={[styles.headerRight, { right: spacing.md }]} pointerEvents="box-none">
          {isOnCurrentWeek ? null : (
            <Pressable
              onPress={goToCurrentWeek}
              accessibilityRole="button"
              accessibilityLabel={t("timetable.goToCurrentWeek")}
              hitSlop={8}
              pressRetentionOffset={{ top: 20, bottom: 20, left: 20, right: 20 }}
              style={({ pressed }) => [styles.todayTarget, { opacity: pressed ? 0.5 : 1 }]}
            >
              <Text style={[typography.label, { color: colors.accentStrong }]}>{t("timetable.today")}</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* No rule between the month and the weekday strip: the strip's own
          underline is the only separator the grid needs. */}
      {grid}

      {dialogs}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  row: {
    flexDirection: "row",
  },
  header: {
    justifyContent: "center",
    alignItems: "center",
  },
  headerCluster: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerLeft: {
    position: "absolute",
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  headerRight: {
    position: "absolute",
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  monthTitle: {
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: 1,
    // A floor rather than a fixed width: it keeps the arrows still for
    // every short month name, and lets a long localised one ("СЕНТ. 2026",
    // "SEP. 2026") take the room it needs instead of being clipped. The
    // cluster is centred on the screen, so growth is symmetrical.
    minWidth: 104,
    maxWidth: 220,
    textAlign: "center",
  },
  arrowTarget: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  todayTarget: {
    minWidth: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  glyph: {
    fontSize: 22,
    lineHeight: 26,
  },
});
