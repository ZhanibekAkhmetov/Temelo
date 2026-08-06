import { memo, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";

import { dayOfMonth, weekDatesFrom } from "@/domain/calendar";
import type { OccurrencePreview } from "@/domain/occurrence";
import { findMajorBoundaries, findPeriodProgress } from "@/domain/time";
import { resolveWeekBlocks } from "@/domain/timetable";
import { isWeekendDay, WEEKDAY_LABEL, WEEKDAY_SHORT_LABEL, type Weekday } from "@/domain/week";
import { DAY_HEADER_HEIGHT, MAX_SLOT_HEIGHT, TIME_GUTTER_WIDTH } from "@/features/timetable/geometry";
import { GridBlock, SelectionOutline } from "@/features/timetable/GridBlock";
import type { PageOverlay } from "@/features/timetable/types";
import { getAppearanceColors } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";
import type { Course, OccurrenceException, Placement, TimeSlot } from "@/types/models";

const DATE_BADGE_SIZE = 28;

/**
 * The grid is meant to recede behind the classes: ordinary period lines are
 * barely there, and only a real break in the day gets a line you notice.
 */
const MINOR_LINE_ALPHA = "59";
const MAJOR_LINE_ALPHA = "B3";
const COLUMN_RULE_ALPHA = "40";

interface WeekPageProps {
  /** Immutable for the lifetime of this page — everything below derives from it. */
  weekStart: string;
  /** Page number in the pager's own coordinates; the page positions itself from it. */
  pageIndex: number;
  /** Continuous pager position, in pages. */
  pos: SharedValue<number>;
  weekdays: Weekday[];
  timeSlots: TimeSlot[];
  placements: Placement[];
  courses: Course[];
  exceptions: OccurrenceException[];
  /** An edit awaiting a scope choice, drawn where it would land. */
  preview: OccurrencePreview | null;
  today: string;
  now: string;
  width: number;
  columnWidth: number;
  slotHeight: SharedValue<number>;
  scrollY: SharedValue<number>;
  /** Set while a block on this page is being dragged, so it is drawn by the overlay instead. */
  hiddenOccurrenceId: string | null;
  /** The provisional range or the selected class, when it belongs to this week. */
  overlay: PageOverlay | null;
}

/**
 * One week, and nothing but that week.
 *
 * Its dates, its classes, its alternating-week occurrences and its "today"
 * marking are all derived from its own `weekStart`, never from whichever
 * page the pager currently calls the current one — so a page's content is
 * fixed for as long as it is mounted, however far mid-swipe the pager is.
 *
 * It also places itself: the horizontal offset is `(pageIndex - pos)`
 * pages, which means mounting or unmounting a neighbour can never shift the
 * pages that stay.
 */
function WeekPageComponent({
  weekStart,
  pageIndex,
  pos,
  weekdays,
  timeSlots,
  placements,
  courses,
  exceptions,
  preview,
  today,
  now,
  width,
  columnWidth,
  slotHeight,
  scrollY,
  hiddenOccurrenceId,
  overlay,
}: WeekPageProps) {
  const { colors, typography, borderWidth, radii, scheme } = useTheme();

  const dates = useMemo(() => weekDatesFrom(weekStart), [weekStart]);
  const blocks = useMemo(
    () => resolveWeekBlocks({ weekdays, dates, placements, courses, exceptions, timeSlots, preview }),
    [weekdays, dates, placements, courses, exceptions, timeSlots, preview],
  );

  // A selected class is ringed in its own colour, one step brighter than the
  // block it surrounds; a range with no class yet has only the accent.
  const selectedBlock =
    overlay?.kind === "selected"
      ? blocks.find((block) => block.dayIndex === overlay.dayIndex && block.startIndex === overlay.startIndex)
      : undefined;
  const overlayStroke = selectedBlock ? getAppearanceColors(selectedBlock.course.appearanceId, scheme).outline : colors.accent;

  const todayColumn = weekdays.findIndex((day) => dates[day] === today);
  const nowProgress = todayColumn >= 0 ? findPeriodProgress(timeSlots, now) : null;
  const majorBoundaries = useMemo(() => findMajorBoundaries(timeSlots), [timeSlots]);

  const pageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (pageIndex - pos.get()) * width }],
  }));

  const bodyStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -scrollY.get() }],
  }));

  return (
    <Animated.View style={[styles.page, { width }, pageStyle]}>
      <View style={[styles.header, { height: DAY_HEADER_HEIGHT, borderBottomWidth: borderWidth.thin, borderColor: colors.border }]}>
        <View style={{ width: TIME_GUTTER_WIDTH }} />
        {weekdays.map((day) => {
          const date = dates[day];
          const isToday = date === today;
          const dayColor = isWeekendDay(day) ? colors.destructive : colors.textMuted;
          return (
            <View key={day} style={[styles.headerCell, { width: columnWidth }]}>
              <Text style={[typography.gridSecondary, styles.weekdayLabel, { color: dayColor }]} numberOfLines={1}>
                {WEEKDAY_SHORT_LABEL[day].toUpperCase()}
              </Text>
              <View style={[styles.dateBadge, { borderRadius: radii.lg, backgroundColor: isToday ? colors.accent : "transparent" }]}>
                <Text
                  style={[
                    styles.dateText,
                    { color: isToday ? colors.background : isWeekendDay(day) ? colors.destructive : colors.textPrimary },
                  ]}
                >
                  {dayOfMonth(date)}
                </Text>
              </View>
            </View>
          );
        })}
      </View>

      <View style={styles.bodyViewport}>
        {/* Tall enough for any zoom level, so the scrolled container itself
            never needs a layout pass while zooming. */}
        <Animated.View style={[styles.body, { height: timeSlots.length * MAX_SLOT_HEIGHT }, bodyStyle]}>
          {timeSlots.map((slot, index) => (
            <PeriodLine
              key={slot.id}
              index={index}
              slotHeight={slotHeight}
              color={`${colors.border}${majorBoundaries[index] ? MAJOR_LINE_ALPHA : MINOR_LINE_ALPHA}`}
              thickness={borderWidth.thin}
            />
          ))}

          {weekdays.map((day, index) => (
            <View
              key={day}
              style={[
                styles.columnRule,
                {
                  left: TIME_GUTTER_WIDTH + index * columnWidth,
                  borderLeftWidth: borderWidth.thin,
                  borderColor: `${colors.border}${COLUMN_RULE_ALPHA}`,
                },
              ]}
            />
          ))}

          {blocks.map((block) =>
            block.occurrenceId === hiddenOccurrenceId ? null : (
              <GridBlock
                // Stable per occurrence, and per the date it is drawn on —
                // an occurrence that moved is the same one somewhere else.
                key={`${block.occurrenceId}|${block.date}`}
                startIndex={block.startIndex}
                span={block.span}
                left={TIME_GUTTER_WIDTH + block.dayIndex * columnWidth}
                width={columnWidth}
                slotHeight={slotHeight}
                appearanceId={block.course.appearanceId}
                name={block.course.name}
                room={block.course.room}
                variant="class"
                accessibilityLabel={`${block.course.name}, ${WEEKDAY_LABEL[block.weekday]}, period ${
                  timeSlots[block.startIndex].position
                }`}
              />
            ),
          )}

          {overlay?.kind === "provisional" ? (
            <GridBlock
              startIndex={overlay.startIndex}
              span={overlay.span}
              left={TIME_GUTTER_WIDTH + overlay.dayIndex * columnWidth}
              width={columnWidth}
              slotHeight={slotHeight}
              variant="provisional"
              accessibilityLabel="New class position, tap again to set it up"
            />
          ) : null}

          {nowProgress ? (
            <NowLine
              slotIndex={nowProgress.index}
              fraction={nowProgress.fraction}
              left={TIME_GUTTER_WIDTH + todayColumn * columnWidth}
              width={columnWidth}
              slotHeight={slotHeight}
              color={colors.destructive}
            />
          ) : null}

          {/* The outline goes last, so it sits above every block on the
              page; a selected class also gets its two resize handles. */}
          {overlay ? (
            <SelectionOutline
              startIndex={overlay.startIndex}
              span={overlay.span}
              left={TIME_GUTTER_WIDTH + overlay.dayIndex * columnWidth}
              width={columnWidth}
              slotHeight={slotHeight}
              color={overlayStroke}
              withHandles={overlay.kind === "selected"}
            />
          ) : null}
        </Animated.View>
      </View>
    </Animated.View>
  );
}

export const WeekPage = memo(WeekPageComponent);

function PeriodLine({
  index,
  slotHeight,
  color,
  thickness,
}: {
  index: number;
  slotHeight: SharedValue<number>;
  color: string;
  thickness: number;
}) {
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: index * slotHeight.get() }] }));
  return <Animated.View pointerEvents="none" style={[styles.periodLine, { borderTopWidth: thickness, borderColor: color }, style]} />;
}

/**
 * The current time, drawn only inside today's column so it reads as "now,
 * here" rather than as a marker running through every day of the week.
 */
function NowLine({
  slotIndex,
  fraction,
  left,
  width,
  slotHeight,
  color,
}: {
  slotIndex: number;
  fraction: number;
  left: number;
  width: number;
  slotHeight: SharedValue<number>;
  color: string;
}) {
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: (slotIndex + fraction) * slotHeight.get() - 1 }] }));
  return (
    <Animated.View pointerEvents="none" style={[styles.nowLine, { left, width }, style]}>
      <View style={[styles.nowDot, { backgroundColor: color }]} />
      <View style={[styles.nowRule, { backgroundColor: color }]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  page: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
  },
  header: {
    flexDirection: "row",
  },
  headerCell: {
    alignItems: "center",
    justifyContent: "center",
  },
  weekdayLabel: {
    letterSpacing: 0.6,
  },
  dateBadge: {
    width: DATE_BADGE_SIZE,
    height: DATE_BADGE_SIZE,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  dateText: {
    fontSize: 15,
    fontWeight: "600",
  },
  bodyViewport: {
    flex: 1,
    overflow: "hidden",
  },
  body: {
    position: "relative",
  },
  periodLine: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },
  columnRule: {
    position: "absolute",
    top: 0,
    bottom: 0,
  },
  nowLine: {
    position: "absolute",
    top: 0,
    height: 2,
    zIndex: 2,
    flexDirection: "row",
    alignItems: "center",
  },
  nowDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  nowRule: {
    flex: 1,
    height: 1.5,
  },
});
