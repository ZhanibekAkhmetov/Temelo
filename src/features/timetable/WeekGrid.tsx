import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { GridCell } from "@/features/timetable/GridCell";
import { findCurrentPeriodIndex, nowHHmm } from "@/domain/time";
import { WEEKDAY_LABEL, WEEKDAY_SHORT_LABEL, type Weekday } from "@/domain/week";
import { useTheme } from "@/theme/useTheme";
import type { Course, Placement, TimeSlot } from "@/types/models";

const HEADER_HEIGHT = 36;
const MIN_ROW_HEIGHT = 56;
const MAX_ROW_HEIGHT = 84;
const WEEKDAY_COL_MIN = 64;
const WEEKDAY_COL_MAX = 84;
const PERIOD_COL_MIN = 90;
const PERIOD_COL_MAX = 130;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export interface SelectedCell {
  weekday: Weekday;
  timeSlot: TimeSlot;
  existing?: { placement: Placement; course: Course };
}

interface WeekGridProps {
  weekdays: Weekday[];
  timeSlots: TimeSlot[];
  placements: Placement[];
  courses: Course[];
  todayWeekday: Weekday;
  onCellPress: (selection: SelectedCell) => void;
}

export function WeekGrid({ weekdays, timeSlots, placements, courses, todayWeekday, onCellPress }: WeekGridProps) {
  const { colors, spacing, typography, borderWidth } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const [bodyHeight, setBodyHeight] = useState(0);

  const horizontalPadding = spacing.sm * 2;
  const weekdayColWidth = clamp(windowWidth * 0.2, WEEKDAY_COL_MIN, WEEKDAY_COL_MAX);
  const availableWidthForPeriods = windowWidth - horizontalPadding - weekdayColWidth;
  const idealPeriodColWidth = timeSlots.length > 0 ? availableWidthForPeriods / timeSlots.length : PERIOD_COL_MAX;
  const periodColWidth = clamp(idealPeriodColWidth, PERIOD_COL_MIN, PERIOD_COL_MAX);
  const gridContentWidth = periodColWidth * timeSlots.length;

  // Rows use the available height up to a comfortable ceiling — filling
  // most of the screen without stretching into the oversized rows (or,
  // capped too low, the excess empty space below) from earlier passes.
  const idealRowHeight = bodyHeight > 0 ? (bodyHeight - HEADER_HEIGHT) / weekdays.length : MAX_ROW_HEIGHT;
  const rowHeight = clamp(idealRowHeight, MIN_ROW_HEIGHT, MAX_ROW_HEIGHT);
  const needsVerticalScroll = bodyHeight > 0 && HEADER_HEIGHT + rowHeight * weekdays.length > bodyHeight + 0.5;

  const activePlacements = useMemo(() => placements.filter((p) => !p.deletedAt), [placements]);

  function findExisting(weekday: Weekday, timeSlotId: string) {
    const placement = activePlacements.find((p) => p.weekday === weekday && p.timeSlotId === timeSlotId);
    if (!placement) return undefined;
    const course = courses.find((c) => c.id === placement.courseId && !c.deletedAt);
    if (!course) return undefined;
    return { placement, course };
  }

  // Initial horizontal scroll to the academically relevant period — only on
  // first appearance or when the time-slot structure itself changes, never
  // re-forced after the user scrolls manually.
  const scrollRef = useRef<ScrollView>(null);
  const targetIndexRef = useRef<number | null>(null);
  const appliedSignatureRef = useRef<string | null>(null);
  const timeSlotsSignature = timeSlots.map((s) => `${s.id}:${s.startTime}-${s.endTime}`).join("|");

  useEffect(() => {
    targetIndexRef.current = findCurrentPeriodIndex(timeSlots, nowHHmm());
    appliedSignatureRef.current = null;
    // Recompute only when the slot structure changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeSlotsSignature]);

  function handleContentSizeChange() {
    if (targetIndexRef.current === null) return;
    if (appliedSignatureRef.current === timeSlotsSignature) return;
    scrollRef.current?.scrollTo({ x: Math.max(0, targetIndexRef.current * periodColWidth), animated: false });
    appliedSignatureRef.current = timeSlotsSignature;
  }

  const periodHeader = (
    <View style={styles.row}>
      {timeSlots.map((slot) => (
        <View
          key={slot.id}
          style={[
            styles.periodHeaderCell,
            {
              width: periodColWidth,
              height: HEADER_HEIGHT,
              borderColor: colors.border,
              borderRightWidth: borderWidth.thin,
              borderBottomWidth: borderWidth.thin,
              backgroundColor: colors.surface,
            },
          ]}
        >
          <Text style={[typography.label, { color: colors.textSecondary }]}>{slot.position}</Text>
          <Text style={[typography.gridSecondary, { color: colors.textMuted }]}>
            {slot.startTime}–{slot.endTime}
          </Text>
        </View>
      ))}
    </View>
  );

  const bodyRows = (
    <View>
      {weekdays.map((day) => (
        <View key={day} style={styles.row}>
          {timeSlots.map((slot) => {
            const existing = findExisting(day, slot.id);
            return (
              <GridCell
                key={slot.id}
                width={periodColWidth}
                height={rowHeight}
                isToday={day === todayWeekday}
                content={
                  existing
                    ? { name: existing.course.name, room: existing.course.room, appearanceId: existing.course.appearanceId }
                    : null
                }
                onPress={() => onCellPress({ weekday: day, timeSlot: slot, existing })}
                accessibilityLabel={
                  existing
                    ? `${existing.course.name}, ${WEEKDAY_LABEL[day]}, period ${slot.position}, ${slot.startTime} to ${slot.endTime}`
                    : `Empty slot, ${WEEKDAY_LABEL[day]}, period ${slot.position}, ${slot.startTime} to ${slot.endTime}`
                }
              />
            );
          })}
        </View>
      ))}
    </View>
  );

  const weekdayColumn = (
    <View style={{ width: weekdayColWidth }}>
      <View
        style={[
          styles.corner,
          {
            height: HEADER_HEIGHT,
            borderColor: colors.border,
            borderRightWidth: borderWidth.thin,
            borderBottomWidth: borderWidth.thin,
            backgroundColor: colors.surface,
          },
        ]}
      />
      {weekdays.map((day) => {
        const isToday = day === todayWeekday;
        return (
          <View
            key={day}
            style={[
              styles.weekdayLabelCell,
              {
                height: rowHeight,
                borderColor: colors.border,
                borderRightWidth: isToday ? 2 : borderWidth.thin,
                borderRightColor: isToday ? colors.accent : colors.border,
                borderBottomWidth: borderWidth.thin,
                backgroundColor: isToday ? colors.todayBackground : colors.surface,
              },
            ]}
          >
            <Text
              style={[typography.label, { color: isToday ? colors.accent : colors.textSecondary, fontWeight: isToday ? "700" : "500" }]}
              numberOfLines={1}
            >
              {WEEKDAY_SHORT_LABEL[day]}
            </Text>
          </View>
        );
      })}
    </View>
  );

  const scrollableSection = (
    <ScrollView
      ref={scrollRef}
      horizontal
      style={styles.flex}
      contentContainerStyle={{ width: gridContentWidth }}
      showsHorizontalScrollIndicator
      onContentSizeChange={handleContentSizeChange}
    >
      <View>
        {periodHeader}
        {bodyRows}
      </View>
    </ScrollView>
  );

  const gridRow = (
    <View style={styles.gridRow}>
      {weekdayColumn}
      {scrollableSection}
    </View>
  );

  return (
    <View style={[styles.flex, { paddingHorizontal: spacing.sm }]} onLayout={(e) => setBodyHeight(e.nativeEvent.layout.height)}>
      {needsVerticalScroll ? (
        <ScrollView style={styles.flex} showsVerticalScrollIndicator={false}>
          {gridRow}
        </ScrollView>
      ) : (
        gridRow
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  gridRow: {
    flexDirection: "row",
  },
  row: {
    flexDirection: "row",
  },
  corner: {},
  periodHeaderCell: {
    alignItems: "center",
    justifyContent: "center",
  },
  weekdayLabelCell: {
    alignItems: "center",
    justifyContent: "center",
  },
});
