import { useEffect, useMemo, useRef } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { dayOfMonth, weekDatesFrom } from "@/domain/calendar";
import { findCurrentPeriodIndex, findPeriodProgress } from "@/domain/time";
import { cellKey, resolveWeekClasses, type ScheduledClass } from "@/domain/timetable";
import { isWeekendDay, type Weekday } from "@/domain/week";
import { GridCell } from "@/features/timetable/GridCell";
import type { SelectedCell, WeekGridProps } from "@/features/timetable/types";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/useTheme";
import type { TimeSlot } from "@/types/models";

const HEADER_HEIGHT = 36;
/** Width of the current-time rule, matching the vertical layout's 1.5pt line. */
const NOW_RULE_WIDTH = 1.5;
const NOW_DOT_SIZE = 6;
const MIN_ROW_HEIGHT = 56;
const MAX_ROW_HEIGHT = 84;
const WEEKDAY_COL_MIN = 64;
const WEEKDAY_COL_MAX = 84;
const PERIOD_COL_MIN = 90;
const PERIOD_COL_MAX = 130;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The transposed layout, kept as a setting: days down the side, periods
 * across, scrolling sideways through the day. Because that sideways scroll
 * owns horizontal gestures, this layout is navigated between weeks with the
 * header arrows rather than by swiping.
 */
export function WeekGridHorizontal({
  weekStart,
  weekdays,
  timeSlots,
  placements,
  courses,
  exceptions,
  preview,
  timetableStart,
  today,
  now,
  width,
  height,
  onCellPress,
}: WeekGridProps) {
  const { colors, typography, borderWidth } = useTheme();
  const { t, format } = useI18n();

  const dates = useMemo(() => weekDatesFrom(weekStart), [weekStart]);
  const classesByCell = useMemo(
    () => resolveWeekClasses({ weekdays, dates, placements, courses, exceptions, timeSlots, preview, timetableStart }),
    [weekdays, dates, placements, courses, exceptions, timeSlots, preview, timetableStart],
  );

  /*
   * Where "now" falls along the period axis.
   *
   * The same `findPeriodProgress` the vertical layout's marker uses, so both
   * layouts agree to the minute about where the current moment is and neither
   * has a rule of its own. Null outside the academic day — before the first
   * period or after the last — which is when a marker would be pointing at
   * nothing.
   *
   * Recomputed only when `now` changes, which `useNow` throttles to the
   * minute. Nothing here animates and nothing updates per frame.
   */
  const nowProgress = findPeriodProgress(timeSlots, now);

  const weekdayColWidth = clamp(width * 0.2, WEEKDAY_COL_MIN, WEEKDAY_COL_MAX);
  const availableWidthForPeriods = width - weekdayColWidth;
  const idealPeriodColWidth = timeSlots.length > 0 ? availableWidthForPeriods / timeSlots.length : PERIOD_COL_MAX;
  const periodColWidth = clamp(idealPeriodColWidth, PERIOD_COL_MIN, PERIOD_COL_MAX);
  const gridContentWidth = periodColWidth * timeSlots.length;

  // Rows use the available height up to a comfortable ceiling — filling
  // most of the screen without stretching into oversized rows.
  const idealRowHeight = height > 0 ? (height - HEADER_HEIGHT) / Math.max(1, weekdays.length) : MAX_ROW_HEIGHT;
  const rowHeight = clamp(idealRowHeight, MIN_ROW_HEIGHT, MAX_ROW_HEIGHT);
  const needsVerticalScroll = height > 0 && HEADER_HEIGHT + rowHeight * weekdays.length > height + 0.5;

  // Initial horizontal scroll to the academically relevant period — only on
  // first appearance or when the time-slot structure itself changes, never
  // re-forced after the user scrolls manually.
  const scrollRef = useRef<ScrollView>(null);
  const targetIndexRef = useRef<number | null>(null);
  const appliedSignatureRef = useRef<string | null>(null);
  const timeSlotsSignature = timeSlots.map((slot) => `${slot.id}:${slot.startTime}-${slot.endTime}`).join("|");

  useEffect(() => {
    targetIndexRef.current = findCurrentPeriodIndex(timeSlots, now);
    appliedSignatureRef.current = null;
    // Recompute only when the slot structure changes, not every minute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeSlotsSignature]);

  /**
   * A tapped cell always resolves to the class's own first period, so
   * tapping the second half of a two-period class edits that class rather
   * than looking like an empty slot underneath it.
   */
  function selectionFor(day: Weekday, date: string, slot: TimeSlot, existing: ScheduledClass | undefined): SelectedCell {
    if (!existing) {
      return { weekday: day, date, timeSlot: slot, slotSpan: 1, endTime: slot.endTime };
    }
    const startIndex = Math.max(0, timeSlots.findIndex((candidate) => candidate.id === existing.placement.timeSlotId));
    const span = Math.max(1, Math.min(existing.placement.slotSpan, timeSlots.length - startIndex));
    return {
      weekday: day,
      date,
      timeSlot: timeSlots[startIndex],
      slotSpan: span,
      endTime: timeSlots[startIndex + span - 1].endTime,
      existing,
    };
  }

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
              borderColor: colors.gridMinor,
              borderRightWidth: borderWidth.thin,
              borderBottomWidth: borderWidth.thin,
            },
          ]}
        >
          <Text style={[typography.gridSecondary, { color: colors.textSecondary }]}>{slot.position}</Text>
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
          {/*
           * The current time, in today's row only.
           *
           * Here the time axis runs across rather than down, so the marker is a
           * vertical rule at `(period + fraction) × columnWidth` instead of a
           * horizontal one at `(period + fraction) × rowHeight`. Everything
           * else about it is the vertical layout's marker: the same
           * `currentTime` colour, the same dot-and-rule, and the same rule that
           * it belongs to the actual current date rather than to whichever week
           * is on screen — page to another week and it is simply not drawn.
           *
           * Absolutely positioned and `pointerEvents="none"`, so it sits over
           * the cells without taking a tap away from the class underneath it.
           */}
          {nowProgress && dates[day] === today ? (
            <View
              pointerEvents="none"
              style={[
                styles.nowMarker,
                {
                  height: rowHeight,
                  // The box is as wide as the dot, not as the rule, so nothing
                  // inside it can overflow its own parent — then offset by half
                  // of that so the rule lands exactly on the minute.
                  left: (nowProgress.index + nowProgress.fraction) * periodColWidth - NOW_DOT_SIZE / 2,
                },
              ]}
            >
              <View style={[styles.nowDot, { backgroundColor: colors.currentTime }]} />
              <View style={[styles.nowRule, { backgroundColor: colors.currentTime }]} />
            </View>
          ) : null}
          {timeSlots.map((slot) => {
            const existing = classesByCell.get(cellKey(day, slot.id));
            const date = dates[day];
            return (
              <GridCell
                key={slot.id}
                width={periodColWidth}
                height={rowHeight}
                isToday={date === today}
                content={
                  existing
                    ? { name: existing.course.name, room: existing.course.room, appearanceId: existing.course.appearanceId }
                    : null
                }
                onPress={() => onCellPress(selectionFor(day, date, slot, existing))}
                accessibilityLabel={t(
                  existing ? "timetable.classAtTime" : "timetable.emptySlotAtTime",
                  {
                    name: existing?.course.name ?? "",
                    weekday: format.weekdayLong(day),
                    period: slot.position,
                    start: slot.startTime,
                    end: slot.endTime,
                  },
                )}
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
        style={{
          height: HEADER_HEIGHT,
          borderColor: colors.gridMinor,
          borderRightWidth: borderWidth.thin,
          borderBottomWidth: borderWidth.thin,
        }}
      />
      {weekdays.map((day) => {
        const date = dates[day];
        const isToday = date === today;
        return (
          <View
            key={day}
            style={[
              styles.weekdayLabelCell,
              {
                height: rowHeight,
                borderColor: colors.gridMinor,
                borderRightWidth: borderWidth.thin,
                borderBottomWidth: borderWidth.thin,
                backgroundColor: isToday ? colors.accentSubtle : "transparent",
              },
            ]}
          >
            <Text
              style={[
                typography.gridSecondary,
                styles.weekdayLabel,
                { color: isWeekendDay(day) ? colors.weekendText : colors.textMuted },
              ]}
              numberOfLines={1}
            >
              {format.weekdayShort(day).toUpperCase()}
            </Text>
            <Text style={[styles.dateText, { color: isToday ? colors.accentStrong : colors.textPrimary }]} numberOfLines={1}>
              {dayOfMonth(date)}
            </Text>
          </View>
        );
      })}
    </View>
  );

  const gridRow = (
    <View style={styles.row}>
      {weekdayColumn}
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
    </View>
  );

  return (
    // When the week is shorter than the space available it is centred in
    // it, rather than pinned to the top with the remainder left blank.
    <View style={[{ width, height }, needsVerticalScroll ? null : styles.centred]}>
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
  centred: {
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
  },
  periodHeaderCell: {
    alignItems: "center",
    justifyContent: "center",
  },
  weekdayLabelCell: {
    alignItems: "center",
    justifyContent: "center",
  },
  weekdayLabel: {
    letterSpacing: 0.6,
  },
  dateText: {
    fontSize: 15,
    fontWeight: "600",
  },
  nowMarker: {
    position: "absolute",
    top: 0,
    width: NOW_DOT_SIZE,
    alignItems: "center",
    zIndex: 2,
  },
  nowDot: {
    width: NOW_DOT_SIZE,
    height: NOW_DOT_SIZE,
    borderRadius: NOW_DOT_SIZE / 2,
  },
  nowRule: {
    flex: 1,
    width: NOW_RULE_WIDTH,
  },
});
