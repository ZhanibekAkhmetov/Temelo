import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { useTheme } from "@/theme/useTheme";
import { selectionTick } from "@/util/haptics";

/**
 * Every row is exactly this tall, always — the selected state is a transform,
 * never a layout change, so the offset-to-index mapping below stays exact for
 * the whole life of the wheel.
 */
export const WHEEL_ITEM_HEIGHT = 56;
const WHEEL_VISIBLE_ROWS = 3;
export const WHEEL_HEIGHT = WHEEL_ITEM_HEIGHT * WHEEL_VISIBLE_ROWS;

const WHEEL_FONT_SIZE = 22;
const WHEEL_COLUMN_MIN_WIDTH = 64;

/** How long the settled value takes to grow into its selected state. */
const SETTLE_DURATION_MS = 150;
const SELECTED_SCALE = 1.18;
const OPACITY_SELECTED = 1;
const OPACITY_SCROLLING = 0.75;
const OPACITY_RESTING = 0.38;

/**
 * A release with no momentum behind it fires no momentum events, so a short
 * check after the drag ends decides whether the wheel is already at rest.
 */
const SETTLE_FALLBACK_MS = 140;

interface WheelPickerProps {
  values: number[];
  value: number;
  onChange: (value: number) => void;
  accessibilityLabel: string;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Rows are laid out from a fixed height, so the scroll offset maps to an item
 * index by simple division. Clamping matters at the ends, where over-scroll
 * can push the offset past the last detent.
 */
function indexForOffset(offsetY: number, count: number): number {
  "worklet";
  const lastIndex = Math.max(count - 1, 0);
  const raw = Math.round(offsetY / WHEEL_ITEM_HEIGHT);
  return raw < 0 ? 0 : raw > lastIndex ? lastIndex : raw;
}

/**
 * One snapping column of a time or duration picker.
 *
 * The wheel has two visual states. While a finger is down, while momentum
 * runs, and while it snaps, every row is drawn at the same size and the same
 * active colour — nothing grows as it passes the centre, so the column never
 * pulses and row geometry never changes. Only once motion has fully stopped
 * does the centred value animate up to its selected treatment, once.
 *
 * Three invariants hold the thing together:
 *
 *  - the wheel is positioned at the incoming value *natively*, through
 *    `contentOffset`, because an imperative `scrollTo` issued while the
 *    content is still unmeasured — which is exactly what happens when the
 *    wheel mounts inside a modal — silently does nothing and leaves the
 *    column parked on the first item while the component believes it is on
 *    the incoming one;
 *  - the centred index is the single source of truth: it drives the haptic,
 *    the emphasis and the committed value, so the displayed value, the saved
 *    value and the row under the centre band can never disagree;
 *  - settling ends with an exact `scrollTo` onto the detent, so the wheel
 *    always rests on one whole valid item.
 *
 * Scrolling itself never touches React state on the UI thread: the offset
 * drives the row styles there, and JavaScript is involved only when the
 * centred value actually changes.
 */
export function WheelPicker({ values, value, onChange, accessibilityLabel }: WheelPickerProps) {
  const { colors } = useTheme();
  const scrollRef = useRef<Animated.ScrollView>(null);

  const selectedIndex = Math.min(Math.max(values.indexOf(value), 0), Math.max(values.length - 1, 0));

  const isMoving = useSharedValue(0);
  const hasMomentum = useSharedValue(0);
  const centeredIndex = useSharedValue(selectedIndex);
  const settledIndex = useSharedValue(selectedIndex);
  const itemCount = useSharedValue(values.length);
  const offsetY = useSharedValue(selectedIndex * WHEEL_ITEM_HEIGHT);

  // The scroll worklet reads these through stable callbacks, so the handler
  // is built once instead of being rebuilt — mid-fling — on every render.
  const latest = useRef({ values, value, onChange });
  useEffect(() => {
    latest.current = { values, value, onChange };
  });

  useEffect(() => {
    itemCount.set(values.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.length]);

  /**
   * Frozen at mount: `contentOffset` is a native prop, and letting it change
   * later would re-apply the offset under a moving finger.
   */
  const [initialOffset] = useState(() => ({ x: 0, y: selectedIndex * WHEEL_ITEM_HEIGHT }));
  const hasPositioned = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commit = useCallback((index: number) => {
    const { values: items, value: current, onChange: notify } = latest.current;
    const next = items[index];
    if (next !== undefined && next !== current) notify(next);
  }, []);

  /** One tick per newly centred value, and the value it belongs to. */
  const crossDetent = useCallback(
    (index: number) => {
      selectionTick();
      commit(index);
    },
    [commit],
  );

  const settle = useCallback(() => {
    if (settleTimer.current) {
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
    const index = centeredIndex.get();
    isMoving.set(0);
    hasMomentum.set(0);
    settledIndex.set(index);
    // Land on the detent exactly, on the rare occasion the native snap left
    // the wheel between two items.
    const target = index * WHEEL_ITEM_HEIGHT;
    if (Math.abs(offsetY.get() - target) > 0.5) {
      offsetY.set(target);
      scrollRef.current?.scrollTo({ y: target, animated: false });
    }
    commit(index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commit]);

  const scheduleSettle = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      settleTimer.current = null;
      if (hasMomentum.get() === 1) return;
      settle();
    }, SETTLE_FALLBACK_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settle]);

  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );

  // Follow the value when it changes from outside, but never yank the wheel
  // out from under a finger, and never re-scroll for a change the wheel just
  // produced itself.
  useEffect(() => {
    if (isMoving.get() === 1) return;
    if (centeredIndex.get() === selectedIndex) {
      settledIndex.set(selectedIndex);
      return;
    }
    centeredIndex.set(selectedIndex);
    settledIndex.set(selectedIndex);
    offsetY.set(selectedIndex * WHEEL_ITEM_HEIGHT);
    scrollRef.current?.scrollTo({ y: selectedIndex * WHEEL_ITEM_HEIGHT, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndex]);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      offsetY.set(event.contentOffset.y);
      const index = indexForOffset(event.contentOffset.y, itemCount.get());
      // Rounding flips at the halfway point, which is the moment the row
      // crosses the centre band — so this runs once per crossed value, not
      // once per frame, and not twice while settling onto the same one.
      if (index === centeredIndex.get()) return;
      centeredIndex.set(index);
      runOnJS(crossDetent)(index);
    },
    onBeginDrag: () => {
      isMoving.set(1);
      hasMomentum.set(0);
      settledIndex.set(-1);
    },
    onEndDrag: () => {
      runOnJS(scheduleSettle)();
    },
    onMomentumBegin: () => {
      isMoving.set(1);
      hasMomentum.set(1);
      settledIndex.set(-1);
    },
    onMomentumEnd: () => {
      hasMomentum.set(0);
      runOnJS(settle)();
    },
  });

  /**
   * Belt and braces for the native offset: once the content has a real
   * height, put the wheel where it belongs. Harmless when `contentOffset`
   * already did the job, decisive when it did not.
   */
  function handleContentSizeChange(_width: number, height: number) {
    if (hasPositioned.current || height <= 0) return;
    hasPositioned.current = true;
    const target = centeredIndex.get() * WHEEL_ITEM_HEIGHT;
    offsetY.set(target);
    scrollRef.current?.scrollTo({ y: target, animated: false });
  }

  return (
    <Animated.ScrollView
      ref={scrollRef}
      style={styles.wheel}
      contentContainerStyle={styles.content}
      contentOffset={initialOffset}
      showsVerticalScrollIndicator={false}
      snapToInterval={WHEEL_ITEM_HEIGHT}
      snapToAlignment="start"
      decelerationRate="fast"
      nestedScrollEnabled
      scrollEventThrottle={16}
      accessibilityLabel={accessibilityLabel}
      onContentSizeChange={handleContentSizeChange}
      onScroll={scrollHandler}
    >
      {values.map((item, index) => (
        <WheelRow
          key={item}
          index={index}
          settledIndex={settledIndex}
          isMoving={isMoving}
          label={pad2(item)}
          color={colors.textPrimary}
        />
      ))}
    </Animated.ScrollView>
  );
}

/**
 * Rows keep a fixed layout height at all times; the selected state is a
 * transform and an opacity change, so nothing around it reflows.
 */
function WheelRow({
  index,
  settledIndex,
  isMoving,
  label,
  color,
}: {
  index: number;
  settledIndex: SharedValue<number>;
  isMoving: SharedValue<number>;
  label: string;
  color: string;
}) {
  const style = useAnimatedStyle(() => {
    const isSettledSelection = settledIndex.get() === index;
    const opacity = isSettledSelection ? OPACITY_SELECTED : isMoving.get() === 1 ? OPACITY_SCROLLING : OPACITY_RESTING;
    return {
      transform: [{ scale: withTiming(isSettledSelection ? SELECTED_SCALE : 1, { duration: SETTLE_DURATION_MS }) }],
      opacity: withTiming(opacity, { duration: SETTLE_DURATION_MS }),
    };
  });

  return (
    <Animated.View style={[styles.row, style]}>
      <Text style={[styles.rowText, { color }]} allowFontScaling={false}>
        {label}
      </Text>
    </Animated.View>
  );
}

interface WheelGroupProps {
  children: ReactNode;
}

/**
 * The frame one or more wheels sit in: a fixed-height box with a single
 * selection band drawn behind the whole row, so the centre reads as one
 * region rather than as a separate highlight per column.
 */
export function WheelGroup({ children }: WheelGroupProps) {
  const { colors, radii, borderWidth } = useTheme();

  return (
    <View style={styles.group}>
      <View
        pointerEvents="none"
        style={[
          styles.band,
          {
            backgroundColor: colors.surfaceAlt,
            borderColor: colors.borderStrong,
            borderWidth: borderWidth.thin,
            borderRadius: radii.lg,
          },
        ]}
      />
      <View style={styles.groupRow}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    height: WHEEL_HEIGHT,
    justifyContent: "center",
  },
  band: {
    position: "absolute",
    left: 0,
    right: 0,
    top: WHEEL_ITEM_HEIGHT,
    height: WHEEL_ITEM_HEIGHT,
  },
  groupRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  wheel: {
    height: WHEEL_HEIGHT,
  },
  content: {
    paddingVertical: WHEEL_ITEM_HEIGHT,
  },
  row: {
    height: WHEEL_ITEM_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    minWidth: WHEEL_COLUMN_MIN_WIDTH,
  },
  rowText: {
    fontSize: WHEEL_FONT_SIZE,
    fontWeight: "500",
    fontVariant: ["tabular-nums"],
  },
});
