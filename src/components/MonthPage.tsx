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
 * One month of the picker, placed by its own page index.
 *
 * The transform reads nothing that can change while a page is settling:
 * `pageIndex` is fixed for as long as this page exists — the page is keyed
 * on its month, so a different index means a different page — and `width`
 * only moves when the field is re-laid-out. So when the pager commits a
 * month and the mounted set shifts along, the pages that survive the commit
 * do not move a pixel, and there is no frame in which the grid and the
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
