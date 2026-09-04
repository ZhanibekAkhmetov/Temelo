import { memo, useMemo, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";

import { dayOfMonth, weekDatesFrom } from "@/domain/calendar";
import type { OccurrencePreview } from "@/domain/occurrence";
import { findMajorBoundaries, findPeriodProgress } from "@/domain/time";
import { resolveWeekBlocks } from "@/domain/timetable";
import { isWeekendDay, WEEKDAY_LABEL, WEEKDAY_SHORT_LABEL, type Weekday } from "@/domain/week";
import {
  DAY_HEADER_HEIGHT,
  MAX_COLUMN_WIDTH,
  MAX_SLOT_HEIGHT,
  TIME_GUTTER_WIDTH,
} from "@/features/timetable/geometry";
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

/** Line box of `typography.gridText`, and the block's vertical padding. */
const NAME_LINE_HEIGHT = 16;
const BLOCK_TEXT_PADDING = 6;
/** Room takes the line under the name, so the name never claims the last one. */
const ROOM_LINE_HEIGHT = 14;
const MAX_NAME_LINES = 5;

/**
 * How many lines a name may wrap to in a block of this many periods.
 *
 * Derived from the *settled* slot height, never from the live one: a pinch
 * moves the box on the UI thread, and re-deriving this every frame would
 * put a React render in the middle of the gesture. Between pinches the
 * block simply has whatever line budget its height affords.
 */
function nameLinesFor(span: number, settledSlotHeight: number): number {
  const textHeight = span * settledSlotHeight - BLOCK_TEXT_PADDING - ROOM_LINE_HEIGHT;
  return Math.max(1, Math.min(MAX_NAME_LINES, Math.floor(textHeight / NAME_LINE_HEIGHT)));
}

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
  /** Settled day-column width; changes once, when a pinch ends. */
  columnWidth: SharedValue<number>;
  /** How far the week is shifted sideways inside its own page, in live pixels. */
  offsetX: SharedValue<number>;
  /** Settled period height; changes once, when a pinch ends. */
  slotHeight: SharedValue<number>;
  /** Slot height as of the last settled zoom, for text that cannot re-flow per frame. */
  settledSlotHeight: number;
  /** Transient pinch scale, 1 unless two fingers are on the grid right now. */
  pinchScaleX: SharedValue<number>;
  pinchScaleY: SharedValue<number>;
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
 * pages that stay. Zoom is a second, independent horizontal offset applied
 * *inside* the page, so a week that is wider than the viewport still slides
 * as one page.
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
  offsetX,
  slotHeight,
  settledSlotHeight,
  pinchScaleX,
  pinchScaleY,
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

  // The scrolled box, fixed for the life of the page and sized for the
  // deepest zoom, so it never needs a layout pass itself — only the boxes
  // inside it, once, when a pinch commits. Its centre is also what the
  // pinch transform below has to correct for.
  const boxWidth = TIME_GUTTER_WIDTH + weekdays.length * MAX_COLUMN_WIDTH;
  const boxHeight = timeSlots.length * MAX_SLOT_HEIGHT;

  const pageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (pageIndex - pos.get()) * width }],
  }));

  /**
   * The one node that moves while a pinch is running.
   *
   * Both scroll axes and the whole transient zoom ride here, so every
   * absolutely positioned child below only has to know its own row and
   * column, in settled coordinates, and none of them re-measure while the
   * fingers are down. A child laid out at settled `X` has to land at
   * `X * scale - offset`, and RN scales about a view's centre, so the
   * centre's own contribution — `centre * (1 - scale)` — is subtracted back
   * out. That is what makes this equivalent to scaling about the grid's
   * top-left corner without depending on `transformOrigin`.
   *
   * `TIME_GUTTER_WIDTH * (1 - scale)` holds the gutter's edge still: the
   * columns start there, and that offset must not be magnified with them.
   */
  const bodyStyle = useAnimatedStyle(() => {
    const scaleX = pinchScaleX.get();
    const scaleY = pinchScaleY.get();
    return {
      transform: [
        { translateX: (TIME_GUTTER_WIDTH - boxWidth / 2) * (1 - scaleX) - offsetX.get() },
        { translateY: -scrollY.get() - (boxHeight / 2) * (1 - scaleY) },
        { scaleX },
        { scaleY },
      ],
    };
  });

  const headerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -offsetX.get() }],
  }));

  return (
    <Animated.View style={[styles.page, { width }, pageStyle]}>
      {/* Clipped, because a zoomed-in week is wider than its own page and
          must not spill onto the neighbouring one. */}
      <View style={[styles.header, { height: DAY_HEADER_HEIGHT, borderBottomWidth: borderWidth.thin, borderColor: colors.border }]}>
        <Animated.View style={[styles.headerRow, { width: weekdays.length * MAX_COLUMN_WIDTH }, headerStyle]}>
          {weekdays.map((day, index) => {
            const date = dates[day];
            const isToday = date === today;
            const dayColor = isWeekendDay(day) ? colors.destructive : colors.textMuted;
            return (
              <DayHeaderCell key={day} index={index} columnWidth={columnWidth} pinchScaleX={pinchScaleX}>
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
              </DayHeaderCell>
            );
          })}
        </Animated.View>
      </View>

      <View style={styles.bodyViewport}>
        <Animated.View style={[styles.body, { height: boxHeight, width: boxWidth }, bodyStyle]}>
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
            <ColumnRule
              key={day}
              index={index}
              columnWidth={columnWidth}
              thickness={borderWidth.thin}
              color={`${colors.border}${COLUMN_RULE_ALPHA}`}
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
                dayIndex={block.dayIndex}
                columnWidth={columnWidth}
                slotHeight={slotHeight}
                appearanceId={block.course.appearanceId}
                name={block.course.name}
                room={block.course.room}
                nameLines={nameLinesFor(block.span, settledSlotHeight)}
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
              dayIndex={overlay.dayIndex}
              columnWidth={columnWidth}
              slotHeight={slotHeight}
              variant="provisional"
              accessibilityLabel="New class position, tap again to set it up"
            />
          ) : null}

          {nowProgress ? (
            <NowLine
              slotIndex={nowProgress.index}
              fraction={nowProgress.fraction}
              dayIndex={todayColumn}
              columnWidth={columnWidth}
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
              dayIndex={overlay.dayIndex}
              columnWidth={columnWidth}
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

/**
 * One day of the weekday strip.
 *
 * A fixed-width box that is *centred* on its column rather than sized to
 * it. Nothing about it is a layout prop, so a pinch moves it with a
 * transform and never re-measures the label or the date badge — and,
 * because the box does not stretch, neither of them is ever drawn
 * distorted the way scaling the strip as a whole would draw them. The
 * boxes overlap at low zoom, which is harmless: they are transparent, the
 * strip takes no touches, and only their centres are ever visible.
 */
function DayHeaderCell({
  index,
  columnWidth,
  pinchScaleX,
  children,
}: {
  index: number;
  columnWidth: SharedValue<number>;
  pinchScaleX: SharedValue<number>;
  children: ReactNode;
}) {
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: (index + 0.5) * columnWidth.get() * pinchScaleX.get() - MAX_COLUMN_WIDTH / 2 }],
  }));
  return <Animated.View style={[styles.headerCell, style]}>{children}</Animated.View>;
}

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

function ColumnRule({
  index,
  columnWidth,
  thickness,
  color,
}: {
  index: number;
  columnWidth: SharedValue<number>;
  thickness: number;
  color: string;
}) {
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: index * columnWidth.get() }] }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.columnRule, { borderLeftWidth: thickness, borderColor: color }, style]}
    />
  );
}

/**
 * The current time, drawn only inside today's column so it reads as "now,
 * here" rather than as a marker running through every day of the week.
 */
function NowLine({
  slotIndex,
  fraction,
  dayIndex,
  columnWidth,
  slotHeight,
  color,
}: {
  slotIndex: number;
  fraction: number;
  dayIndex: number;
  columnWidth: SharedValue<number>;
  slotHeight: SharedValue<number>;
  color: string;
}) {
  const style = useAnimatedStyle(() => {
    const width = columnWidth.get();
    return {
      width,
      transform: [{ translateX: dayIndex * width }, { translateY: (slotIndex + fraction) * slotHeight.get() - 1 }],
    };
  });
  return (
    <Animated.View pointerEvents="none" style={[styles.nowLine, style]}>
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
    overflow: "hidden",
  },
  header: {
    overflow: "hidden",
  },
  // Wide enough for the largest zoom, so every cell stays inside its own
  // parent and nothing depends on how a platform clips an overflowing child.
  headerRow: {
    position: "absolute",
    left: TIME_GUTTER_WIDTH,
    top: 0,
    bottom: 0,
  },
  headerCell: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: MAX_COLUMN_WIDTH,
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
    left: TIME_GUTTER_WIDTH,
    top: 0,
    bottom: 0,
  },
  nowLine: {
    position: "absolute",
    left: TIME_GUTTER_WIDTH,
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
