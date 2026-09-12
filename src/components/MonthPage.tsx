import { memo } from "react";
import { StyleSheet } from "react-native";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";

import { CalendarMonth } from "@/components/CalendarMonth";

interface MonthPageProps {
  /** Immutable for the lifetime of this page — the month it draws, ISO. */
  month: string;
  /** Page number in the pager's own coordinates; the page positions itself from it. */
  pageIndex: number;
  /** Continuous pager position, in pages. */
  pos: SharedValue<number>;
  width: number;
  /** Selected date, ISO — may belong to another month. */
  value: string;
  today: string;
  onSelect: (isoDate: string) => void;
}

/**
 * One slot of the picker's ring, placed by its own page index.
 *
 * A slot outlives the months it draws: when it falls out of range it is handed
 * a new `month` and `pageIndex` together, in one render, while it is two pages
 * off screen on one side and about to be two pages off screen on the other.
 * The four slots that stay in range keep their props, so they do not move a
 * pixel or re-render at all, and there is no frame in which the grid and the
 * heading disagree.
 */
export const MonthPage = memo(function MonthPage({
  month,
  pageIndex,
  pos,
  width,
  value,
  today,
  onSelect,
}: MonthPageProps) {
  const pageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (pageIndex - pos.get()) * width }],
  }));

  return (
    <Animated.View style={[styles.page, { width }, pageStyle]}>
      <CalendarMonth month={month} width={width} value={value} today={today} onSelect={onSelect} />
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  page: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
  },
});
