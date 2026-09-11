import { memo, useMemo, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";

import { dayOfMonth, weekDatesFrom } from "@/domain/calendar";
import type { OccurrencePreview } from "@/domain/occurrence";
import { findMajorBoundaries, findPeriodProgress } from "@/domain/time";
import { resolveWeekBlocks } from "@/domain/timetable";
import { isWeekendDay, type Weekday } from "@/domain/week";
import {
  DAY_HEADER_HEIGHT,
  MAX_COLUMN_WIDTH,
  MAX_SLOT_HEIGHT,
  TIME_GUTTER_WIDTH,
  topInsetFor,
} from "@/features/timetable/geometry";
import { GridBlock, SelectionOutline } from "@/features/timetable/GridBlock";
import type { PageOverlay } from "@/features/timetable/types";
import { useI18n } from "@/i18n/I18nProvider";
import { getClassColors } from "@/theme/classColors";
import { useTheme } from "@/theme/useTheme";
import type { Course, OccurrenceException, Placement, TimeSlot } from "@/types/models";

const DATE_BADGE_SIZE = 28;

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
  /**
   * The week this page is currently drawing; everything below derives from it.
   * It changes when the slot is recycled onto another week — see `pageWindow`.
   */
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
  /** Height of the scrolled body, below the weekday strip — what the grid is centred in. */
  bodyHeight: number;
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
 * marking are all derived from its own `weekStart` prop, never from whichever
 * page the pager currently calls the current one — so whatever a page is
 * drawing is internally consistent, however far mid-swipe the pager is.
 *
 * It is *recycled* rather than replaced. There are three of these for the life
 * of the surface and paging hands them different weeks; a page's React key is
 * its slot in the window, not its week. Nothing about this component depends on
 * that — everything below reads from props — and `memo` means a slot whose week
 * did not change does not re-render at all. See `pageWindow` for why the
 * alternative, a key per week, was what made paging slow.
 *
 * It also places itself: the horizontal offset is `(pageIndex - pos)` pages, so
 * recycling one slot can never shift the two that kept their week. Zoom is a
 * second, independent horizontal offset applied *inside* the page, so a week
 * that is wider than the viewport still slides as one page.
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
  bodyHeight,
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
  const { colors, typography, borderWidth, radii } = useTheme();
  const { t, format } = useI18n();

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
  const overlayStroke = selectedBlock ? getClassColors(selectedBlock.course.appearanceId).outline : colors.accent;

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
    // Added to the translation rather than folded into the scaled term: the
    // grid is inset, not magnified, so the gap above a short academic day must
    // stay the same size whatever the pinch is doing to the rows inside it.
    const inset = topInsetFor(slotHeight.get() * scaleY, timeSlots.length, bodyHeight);
    return {
      transform: [
        { translateX: (TIME_GUTTER_WIDTH - boxWidth / 2) * (1 - scaleX) - offsetX.get() },
        { translateY: inset - scrollY.get() - (boxHeight / 2) * (1 - scaleY) },
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
      <View
        style={[
          styles.header,
          {
            height: DAY_HEADER_HEIGHT,
            backgroundColor: colors.headerBackground,
            borderBottomWidth: borderWidth.thin,
            borderColor: colors.divider,
          },
        ]}
      >
        <Animated.View style={[styles.headerRow, { width: weekdays.length * MAX_COLUMN_WIDTH }, headerStyle]}>
          {weekdays.map((day, index) => {
            const date = dates[day];
            const isToday = date === today;
            const dayColor = isWeekendDay(day) ? colors.weekendText : colors.textMuted;
            return (
              <DayHeaderCell key={day} index={index} columnWidth={columnWidth} pinchScaleX={pinchScaleX}>
                <Text style={[typography.gridSecondary, styles.weekdayLabel, { color: dayColor }]} numberOfLines={1}>
                  {format.weekdayShort(day).toUpperCase()}
                </Text>
                <View style={[styles.dateBadge, { borderRadius: radii.lg, backgroundColor: isToday ? colors.accent : "transparent" }]}>
                  <Text
                    style={[
                      styles.dateText,
                      {
                        color: isToday
                          ? colors.textOnAccent
                          : isWeekendDay(day)
                            ? colors.weekendText
                            : colors.textPrimary,
                      },
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
              color={majorBoundaries[index] ? colors.gridMajor : colors.gridMinor}
              thickness={borderWidth.thin}
            />
          ))}
          {/*
           * The line under the last period.
           *
           * Every other line is the *top* of a period, which is invisible as a
           * choice for as long as the grid is taller than the screen — you
           * simply never see past the bottom of it. A day that fits does, and
           * without this the last period had no bottom edge at all: the class
           * blocks stopped, the day-column rules carried on down the page, and
           * the grid looked like it had been cut off rather than ended.
           */}
          <PeriodLine
            index={timeSlots.length}
            slotHeight={slotHeight}
            color={colors.gridMajor}
            thickness={borderWidth.thin}
          />

          {weekdays.map((day, index) => (
            <ColumnRule
              key={day}
              index={index}
              slotCount={timeSlots.length}
              columnWidth={columnWidth}
              slotHeight={slotHeight}
              thickness={borderWidth.thin}
              color={colors.gridColumnRule}
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
                accessibilityLabel={t("timetable.classAt", {
                  name: block.course.name,
                  weekday: format.weekdayLong(block.weekday),
                  period: timeSlots[block.startIndex].position,
                })}
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
              accessibilityLabel={t("timetable.newRangeHint")}
            />
          ) : null}

          {nowProgress ? (
            <NowLine
              slotIndex={nowProgress.index}
              fraction={nowProgress.fraction}
              dayIndex={todayColumn}
              columnWidth={columnWidth}
              slotHeight={slotHeight}
              color={colors.currentTime}
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

/**
 * Memoized, and for one specific reason: a page is recycled onto another week
 * rather than rebuilt, and none of these lines care which week that is. Their
 * props — an index, a shared value, a colour — are identical across a page
 * change, so this is the difference between re-rendering fourteen grid lines per
 * swipe and re-rendering none.
 */
const PeriodLine = memo(function PeriodLine({
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
})

/**
 * The line between two day columns.
 *
 * Its height is the academic day, not the box it is drawn in. The box is sized
 * once for the deepest zoom — `slotCount × MAX_SLOT_HEIGHT`, several times
 * taller than the grid at any ordinary scale — so a rule pinned to the box's
 * bottom ran hundreds of points past the end of the day. That was invisible
 * while the grid was taller than the screen and obvious the moment it was not:
 * bare vertical lines continuing below the last period, down to nothing.
 */
/** Memoized for the same reason as `PeriodLine`. */
const ColumnRule = memo(function ColumnRule({
  index,
  slotCount,
  columnWidth,
  slotHeight,
  thickness,
  color,
}: {
  index: number;
  slotCount: number;
  columnWidth: SharedValue<number>;
  slotHeight: SharedValue<number>;
  thickness: number;
  color: string;
}) {
  const style = useAnimatedStyle(() => ({
    height: slotCount * slotHeight.get(),
    transform: [{ translateX: index * columnWidth.get() }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.columnRule, { borderLeftWidth: thickness, borderColor: color }, style]}
    />
  );
})

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
