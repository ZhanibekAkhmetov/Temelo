import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { addWeeksIso, startOfWeekIso } from "@/domain/calendar";
import {
  createPendingClassEdit,
  onlyThisBlockedReason,
  type EditScope,
  type PendingClassEdit,
} from "@/domain/classEdit";
import { addDaysIso } from "@/domain/date";
import { getOrderedWeekdays } from "@/domain/week";
import { ClassEditorModal } from "@/features/timetable/ClassEditorModal";
import { EditScopeSheet } from "@/features/timetable/EditScopeSheet";
import {
  TimetableSurface,
  type MoveOutcome,
  type OccurrenceMove,
  type OccurrencePosition,
  type PlacementPosition,
  type TimetableSurfaceHandle,
} from "@/features/timetable/TimetableSurface";
import { WeekGridHorizontal } from "@/features/timetable/WeekGridHorizontal";
import { useNow } from "@/features/timetable/useNow";
import type { SelectedCell } from "@/features/timetable/types";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppState } from "@/state/AppStateContext";
import { useTheme } from "@/theme/useTheme";

/** Thursday names the month a week belongs to when it straddles two. */
const MONTH_LABEL_DAY_OFFSET = 3;

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

  // The tick is also what carries the timetable over midnight, so the date
  // comes from it rather than from a bare call here: everything below is
  // derived from state and re-read whenever the moment actually changes.
  const now = useNow();
  const today = now.date;
  const currentWeekStart = startOfWeekIso(today);
  const [visibleWeekStart, setVisibleWeekStart] = useState(currentWeekStart);

  const surfaceRef = useRef<TimetableSurfaceHandle>(null);
  // Stable identity, so a minute tick cannot invalidate the memoised pages.
  const weekdays = useMemo(() => getOrderedWeekdays(state.settings.weekendMode), [state.settings.weekendMode]);
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

  /**
   * A settled drag or resize. A class that meets once has no series to
   * scope against, so it simply moves; anything that repeats is drafted and
   * the scope question is asked before the store hears about it at all.
   */
  const handleMoveClass = useCallback(
    (move: OccurrenceMove): MoveOutcome => {
      const series = move.occurrence.basePlacement;
      if (series.recurrenceType === "once") {
        const result = movePlacement({
          placementId: series.id,
          weekday: move.weekday,
          timeSlotId: move.timeSlotId,
          slotSpan: move.slotSpan,
          occurrenceDate: move.occurrence.occurrenceDate,
          date: move.date,
        });
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
    setPendingEdit(null);
    surfaceRef.current?.settleDeferredDrag(!result.ok);
    if (!result.ok) Alert.alert(t("timetable.cannotApply"), t(result.error.key, result.error.params));
  }

  // Asked once per crossed boundary while dragging, so the preview can show
  // whether the drop would be accepted before the finger lifts. Both go to
  // the store, so the answer is the one the commit will give.
  const handleCanPlaceClass = useCallback((input: PlacementPosition) => checkPlacement(input).ok, [checkPlacement]);
  const handleCanPlaceOccurrence = useCallback(
    (input: OccurrencePosition) => checkOccurrence(input).ok,
    [checkOccurrence],
  );

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
            today={today}
            now={now.time}
            onVisibleWeekChange={setVisibleWeekStart}
            onOpenEditor={setSelected}
            onMoveClass={handleMoveClass}
            canPlaceClass={handleCanPlaceClass}
            canPlaceOccurrence={handleCanPlaceOccurrence}
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
            today={today}
            now={now.time}
            width={gridSize.width}
            height={gridSize.height}
            onCellPress={setSelected}
          />
        )}
      </View>

      {selected ? (
        <ClassEditorModal
          visible
          onClose={() => setSelected(null)}
          weekday={selected.weekday}
          date={selected.date}
          timeSlot={selected.timeSlot}
          slotSpan={selected.slotSpan}
          endTime={selected.endTime}
          term={state.term}
          existing={selected.existing}
          onRequestScope={setPendingEdit}
        />
      ) : null}

      {/* Never in the same frame as the editor: they are two native modals,
          and the editor's save is what raises this one. */}
      {pendingEdit && !selected ? (
        <EditScopeSheet
          effectiveDate={pendingEdit.draft.effectiveDate}
          onlyThisBlockedReason={onlyThisBlockedReason(pendingEdit.draft)}
          onSelect={handleScopeSelect}
          onCancel={handleScopeCancel}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
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
