import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { CalendarMonth, CALENDAR_MONTH_GRID_HEIGHT } from "@/components/CalendarMonth";
import { addMonthsIso, monthYearLabel } from "@/domain/calendar";
import {
  PAGE_COMMIT_FRACTION,
  PAGE_FLICK_VELOCITY,
  PAGE_SPRING,
  PAGE_VELOCITY_PROJECTION_SECONDS,
  TOUCH_SLOP,
} from "@/features/timetable/motion";
import { useTheme } from "@/theme/useTheme";

const NAV_ROW_HEIGHT = 40;
const PAGE_OFFSETS = [-1, 0, 1];

export const MONTH_PAGER_HEIGHT = NAV_ROW_HEIGHT + CALENDAR_MONTH_GRID_HEIGHT;

interface MonthPagerProps {
  /** Selected date, ISO. */
  value: string;
  today: string;
  onSelect: (isoDate: string) => void;
}

/**
 * The month grid as a horizontally paged surface: neighbouring months are
 * already mounted beside the current one and follow the finger, and the
 * heading only changes once a page has settled. The arrows drive the same
 * animation rather than swapping the month out instantly.
 */
export function MonthPager({ value, today, onSelect }: MonthPagerProps) {
  const { colors, typography } = useTheme();
  const [width, setWidth] = useState(0);
  const [baseIndex, setBaseIndex] = useState(0);

  // Months are addressed relative to the month the field opened on.
  const [anchorMonth] = useState(value);
  const visibleMonth = addMonthsIso(anchorMonth, baseIndex);

  const pos = useSharedValue(0);
  const startPos = useSharedValue(0);
  // Settled page index, mirrored where both worklets and callbacks can read it.
  const baseIdx = useSharedValue(0);

  const commitMonth = useCallback(
    (direction: number) => {
      if (direction === 0) return;
      const next = baseIdx.get() + direction;
      baseIdx.set(next);
      setBaseIndex(next);
    },
    [baseIdx],
  );

  const animateBy = useCallback(
    (direction: number) => {
      if (direction === 0) return;
      pos.set(
        withSpring(baseIdx.get() + direction, PAGE_SPRING, (finished) => {
          if (finished) runOnJS(commitMonth)(direction);
        }),
      );
    },
    [baseIdx, commitMonth, pos],
  );

  const pan = Gesture.Pan()
    .activeOffsetX([-TOUCH_SLOP, TOUCH_SLOP])
    .failOffsetY([-TOUCH_SLOP, TOUCH_SLOP])
    .onBegin(() => {
      "worklet";
      cancelAnimation(pos);
      startPos.set(pos.get());
    })
    .onUpdate((event) => {
      "worklet";
      if (width <= 0) return;
      pos.set(startPos.get() - event.translationX / width);
    })
    .onEnd((event) => {
      "worklet";
      if (width <= 0) return;
      const travelled = pos.get() - baseIdx.get();
      const velocityPages = -event.velocityX / width;
      const projected = travelled + velocityPages * PAGE_VELOCITY_PROJECTION_SECONDS;

      let direction = 0;
      if (Math.abs(velocityPages) >= PAGE_FLICK_VELOCITY) direction = velocityPages > 0 ? 1 : -1;
      else if (Math.abs(projected) >= PAGE_COMMIT_FRACTION) direction = projected > 0 ? 1 : -1;

      pos.set(withSpring(baseIdx.get() + direction, { ...PAGE_SPRING, velocity: velocityPages }, (finished) => {
        if (finished && direction !== 0) runOnJS(commitMonth)(direction);
      }));
    });

  const pagerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -(pos.get() - baseIndex + 1) * width }],
  }));

  return (
    <View
      onLayout={(event) => {
        const measured = event.nativeEvent.layout.width;
        setWidth((previous) => (previous === measured ? previous : measured));
      }}
    >
      <View style={[styles.navRow, { height: NAV_ROW_HEIGHT }]}>
        <Pressable onPress={() => animateBy(-1)} accessibilityRole="button" accessibilityLabel="Previous month" hitSlop={10}>
          <Text style={[styles.navGlyph, { color: colors.textSecondary }]}>‹</Text>
        </Pressable>
        <Text style={[typography.subtitle, { color: colors.textPrimary }]}>{monthYearLabel(visibleMonth)}</Text>
        <Pressable onPress={() => animateBy(1)} accessibilityRole="button" accessibilityLabel="Next month" hitSlop={10}>
          <Text style={[styles.navGlyph, { color: colors.textSecondary }]}>›</Text>
        </Pressable>
      </View>

      <View style={[styles.viewport, { height: CALENDAR_MONTH_GRID_HEIGHT }]}>
        {width === 0 ? null : (
          <GestureDetector gesture={pan}>
            <Animated.View style={[styles.pager, { width: width * PAGE_OFFSETS.length }, pagerStyle]}>
              {PAGE_OFFSETS.map((offset) => {
                const month = addMonthsIso(anchorMonth, baseIndex + offset);
                return <CalendarMonth key={month} month={month} width={width} value={value} today={today} onSelect={onSelect} />;
              })}
            </Animated.View>
          </GestureDetector>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
  },
  navGlyph: {
    fontSize: 22,
    lineHeight: 26,
    paddingHorizontal: 8,
  },
  viewport: {
    overflow: "hidden",
  },
  pager: {
    flexDirection: "row",
  },
});
