import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";

import { findPeriodProgress } from "@/domain/time";
import { DAY_HEADER_HEIGHT, MAX_SLOT_HEIGHT, TIME_GUTTER_WIDTH } from "@/features/timetable/geometry";
import { useTheme } from "@/theme/useTheme";
import type { TimeSlot } from "@/types/models";

interface TimeGutterProps {
  timeSlots: TimeSlot[];
  now: string;
  /** Whether today's week is the one on screen — drives the now label. */
  showNowLabel: boolean;
  /** Continuous page position, so the label fades out as another week is dragged in. */
  pageDistanceFromToday: SharedValue<number>;
  slotHeight: SharedValue<number>;
  scrollY: SharedValue<number>;
}

/**
 * The hour column. It stays put while weeks page sideways — the times are
 * the same in every week — and scrolls and zooms with the grid. Kept narrow
 * with almost no right padding so the grid keeps the width.
 */
export function TimeGutter({ timeSlots, now, showNowLabel, pageDistanceFromToday, slotHeight, scrollY }: TimeGutterProps) {
  const { colors } = useTheme();
  const nowProgress = showNowLabel ? findPeriodProgress(timeSlots, now) : null;

  // Only the offset animates; the box is sized for the largest zoom level
  // once, so scrolling and zooming never trigger a layout pass here.
  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -scrollY.get() }],
  }));

  return (
    <View style={[styles.gutter, { width: TIME_GUTTER_WIDTH, backgroundColor: colors.background }]} pointerEvents="none">
      <View style={{ height: DAY_HEADER_HEIGHT }} />
      <View style={styles.viewport}>
        <Animated.View style={[{ height: timeSlots.length * MAX_SLOT_HEIGHT }, contentStyle]}>
          {timeSlots.map((slot, index) => (
            <GutterLabel key={slot.id} index={index} slotHeight={slotHeight} text={slot.startTime} color={colors.textMuted} />
          ))}

          {nowProgress ? (
            <NowLabel
              slotIndex={nowProgress.index}
              fraction={nowProgress.fraction}
              slotHeight={slotHeight}
              distance={pageDistanceFromToday}
              text={now}
              color={colors.destructive}
              background={colors.background}
            />
          ) : null}
        </Animated.View>
      </View>
    </View>
  );
}

function GutterLabel({
  index,
  slotHeight,
  text,
  color,
}: {
  index: number;
  slotHeight: SharedValue<number>;
  text: string;
  color: string;
}) {
  const { typography } = useTheme();
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: index * slotHeight.get() + 2 }] }));
  return (
    <Animated.View style={[styles.label, style]}>
      {/* The gutter is a fixed-width axis; a scaled-up label would be
          truncated rather than readable, so this one keeps its size. */}
      <Text style={[typography.gridSecondary, { color }]} numberOfLines={1} allowFontScaling={false}>
        {text}
      </Text>
    </Animated.View>
  );
}

/**
 * The current time, in the gutter, aligned with the line drawn in today's
 * column. It sits on an opaque chip so it replaces rather than overlaps the
 * period label it lands on, and fades out as soon as another week is
 * dragged into view.
 */
function NowLabel({
  slotIndex,
  fraction,
  slotHeight,
  distance,
  text,
  color,
  background,
}: {
  slotIndex: number;
  fraction: number;
  slotHeight: SharedValue<number>;
  distance: SharedValue<number>;
  text: string;
  color: string;
  background: string;
}) {
  const { typography } = useTheme();
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (slotIndex + fraction) * slotHeight.get() - 7 }],
    opacity: Math.max(0, 1 - Math.abs(distance.get()) * 3),
  }));

  return (
    <Animated.View style={[styles.nowLabel, { backgroundColor: background }, animatedStyle]}>
      <Text style={[typography.gridSecondary, styles.nowLabelText, { color }]} numberOfLines={1} allowFontScaling={false}>
        {text}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  gutter: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
  },
  viewport: {
    flex: 1,
    overflow: "hidden",
  },
  label: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 1,
    alignItems: "flex-end",
  },
  nowLabel: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 1,
    alignItems: "flex-end",
    paddingVertical: 1,
  },
  nowLabelText: {
    fontWeight: "600",
  },
});
