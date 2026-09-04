import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  cancelAnimation,
  runOnJS,
  useAnimatedReaction,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { CALENDAR_MONTH_GRID_HEIGHT } from "@/components/CalendarMonth";
import { MonthPage } from "@/components/MonthPage";
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

/** How far off a whole page the pager may be and still count as at rest. */
const SETTLED_EPSILON = 0.01;

/** Arrow presses that outrun the animation; further ones are coalesced. */
const MAX_QUEUED_STEPS = 6;

export const MONTH_PAGER_HEIGHT = NAV_ROW_HEIGHT + CALENDAR_MONTH_GRID_HEIGHT;

function clamp(value: number, min: number, max: number): number {
  "worklet";
  return Math.min(max, Math.max(min, value));
}

interface MonthPagerProps {
  /** Selected date, ISO. */
  value: string;
  today: string;
  onSelect: (isoDate: string) => void;
}

/**
 * The month grid as a horizontally paged surface, built on the same three
 * rules as the timetable's week pager:
 *
 * - previous, current and next are all mounted, and each one *places itself*
 *   from its own page index against a shared position. There is no wrapper
 *   whose transform has to be corrected whenever the mounted set changes.
 * - a page's identity is its month, so the key is the year-month itself.
 *   Committing a month re-labels which pages are neighbours; it never turns
 *   one month's page into another's.
 * - the logical month is committed only by a settle that ran to completion,
 *   and it is read back from where the pager actually is rather than counted
 *   in steps, so it cannot drift.
 *
 * The heading is deliberately *not* the committed month: it names whichever
 * page is nearest, so it turns over on the midpoint rather than at the end
 * of the settle. What the two share is the position they are both read from,
 * which is what keeps them from ever disagreeing about the dates on screen.
 * The arrows drive the same spring a swipe does rather than swapping the
 * month out instantly.
 */
export function MonthPager({ value, today, onSelect }: MonthPagerProps) {
  const { colors, typography } = useTheme();
  const [width, setWidth] = useState(0);

  /**
   * The settled page, plus a tick that changes on *every* settle even when
   * the page does not. Draining queued arrow presses hangs off the tick, so
   * a drag that springs back where it started still releases them.
   */
  const [settled, setSettled] = useState({ index: 0, tick: 0 });

  /**
   * The page the heading names — the one nearest the eye, which is not the
   * same thing as the committed one and must not wait for it. See the
   * reaction below.
   */
  const [headerIndex, setHeaderIndex] = useState(0);

  // Months are addressed relative to the month the field opened on.
  const [anchorMonth] = useState(value);
  const headerMonth = addMonthsIso(anchorMonth, headerIndex);

  /** Continuous page position, in months; `settled.index` is the committed one. */
  const pos = useSharedValue(0);
  const panStartPos = useSharedValue(0);
  const panActive = useSharedValue(0);
  /** Page width, mirrored where worklets can read it without capturing state. */
  const pageWidth = useSharedValue(0);
  /** Settled page index, mirrored for the worklets and callbacks that need it. */
  const baseIdx = useSharedValue(0);
  /** The whole page the pager is heading for; only a starting spring moves it. */
  const targetIdx = useSharedValue(0);

  /**
   * Arrow presses that arrived before their destination page was mounted.
   * A shared value rather than a ref: a drag clears the queue from its own
   * worklet, and the gesture is built during render.
   */
  const queuedSteps = useSharedValue(0);

  const showHeaderMonth = useCallback((index: number) => {
    setHeaderIndex((previous) => (previous === index ? previous : index));
  }, []);

  /**
   * The heading names whichever page is currently the dominant one, not the
   * one the pager has committed to.
   *
   * The two have to be separate. Committing is a decision — it may not
   * happen at all, and when it does it belongs at the end of a settle, where
   * nothing can still take it back. Naming the page in view is a
   * description, and it is wrong the moment it lags what the eye can see:
   * past the halfway mark the destination month is the one being read, so
   * that is the one the heading has to say, whether the drag is still going,
   * settling, or about to be reversed.
   *
   * Derived by rounding the shared position, so it changes exactly when the
   * *nearest* page changes — once, on the midpoint crossing. Everything
   * between crossings stays on the UI thread: React is only told when the
   * answer is genuinely different, so a drag costs at most one render per
   * month boundary it passes over, in either direction.
   */
  useAnimatedReaction(
    () => Math.round(pos.get()),
    (nearest, previous) => {
      if (nearest === previous) return;
      runOnJS(showHeaderMonth)(nearest);
    },
  );

  /**
   * Brings the committed month into line with the page the pager came to
   * rest on. Absolute rather than "advance by one": a spring that is
   * replaced mid-flight would otherwise leave the heading a month behind
   * the grid for good.
   */
  const commitSettled = useCallback(() => {
    const landed = Math.round(pos.get());
    baseIdx.set(landed);
    setSettled((previous) => ({ index: landed, tick: previous.tick + 1 }));
  }, [baseIdx, pos]);

  /**
   * Every page change goes through here — swipe release, arrow press and
   * queued arrow press alike — so all three settle and commit identically.
   *
   * A cancelled spring commits nothing: whatever cancelled it (a new drag,
   * an arrow) starts its own spring, and that one commits in its place.
   */
  const settleTo = useCallback(
    (target: number, velocity: number) => {
      "worklet";
      targetIdx.set(target);
      pos.set(
        withSpring(target, { ...PAGE_SPRING, velocity }, (finished) => {
          if (finished) runOnJS(commitSettled)();
        }),
      );
    },
    [commitSettled, pos, targetIdx],
  );

  // A settle has landed: release one queued arrow press, if any is waiting.
  useEffect(() => {
    const queued = queuedSteps.get();
    if (queued === 0) return;
    const direction = Math.sign(queued);
    queuedSteps.set(queued - direction);
    settleTo(settled.index + direction, 0);
  }, [queuedSteps, settled, settleTo]);

  const stepMonth = useCallback(
    (direction: number) => {
      // The finger owns the pager while it is down; an arrow must not fight it.
      if (panActive.get() === 1) return;

      const target = targetIdx.get() + direction;
      // Only the settled month's neighbours are mounted, so a press that
      // outruns the animation waits for it rather than sliding towards a
      // page that is not there yet.
      if (Math.abs(target - baseIdx.get()) > 1) {
        queuedSteps.set(clamp(queuedSteps.get() + direction, -MAX_QUEUED_STEPS, MAX_QUEUED_STEPS));
        return;
      }
      settleTo(target, 0);
    },
    [baseIdx, panActive, queuedSteps, settleTo, targetIdx],
  );

  /**
   * A date is selected only from a pager that is standing still. A drag
   * cancels the press underneath it anyway, but a release that lands while
   * a page is still on its way would otherwise select a date the user was
   * never looking at.
   */
  const handleSelect = useCallback(
    (isoDate: string) => {
      if (panActive.get() === 1) return;
      const position = pos.get();
      if (Math.abs(position - Math.round(position)) > SETTLED_EPSILON) return;
      onSelect(isoDate);
    },
    [onSelect, panActive, pos],
  );

  const pan = Gesture.Pan()
    .activeOffsetX([-TOUCH_SLOP, TOUCH_SLOP])
    .failOffsetY([-TOUCH_SLOP, TOUCH_SLOP])
    .maxPointers(1)
    .onStart(() => {
      "worklet";
      // Taken over only once the pan has actually claimed the horizontal
      // axis. Grabbing it at touch-down instead would freeze a settle that
      // is still running under a finger that turns out to be a tap.
      cancelAnimation(pos);
      panActive.set(1);
      panStartPos.set(pos.get());
      targetIdx.set(Math.round(pos.get()));
      // A swipe supersedes anything the arrows had lined up.
      queuedSteps.set(0);
    })
    .onUpdate((event) => {
      "worklet";
      const size = pageWidth.get();
      if (size <= 0) return;
      // One month per gesture, and never past a page that is not mounted:
      // the drag stops dead at a neighbour instead of dragging blank space
      // in behind it.
      const origin = Math.round(panStartPos.get());
      const base = baseIdx.get();
      const low = Math.max(origin - 1, base - 1);
      const high = Math.min(origin + 1, base + 1);
      pos.set(clamp(panStartPos.get() - event.translationX / size, low, high));
    })
    .onEnd((event, success) => {
      "worklet";
      const size = pageWidth.get();
      // Measured from the page the drag started on, not from the committed
      // month: during a settle those differ, and the committed one is stale.
      const origin = Math.round(panStartPos.get());

      if (!success || size <= 0) {
        // Cut short rather than released — a second finger, most likely.
        // Back to where the drag began, committing nothing.
        settleTo(origin, 0);
        return;
      }

      const travelled = pos.get() - origin;
      const velocityPages = -event.velocityX / size;
      const projected = travelled + velocityPages * PAGE_VELOCITY_PROJECTION_SECONDS;

      let direction = 0;
      if (Math.abs(velocityPages) >= PAGE_FLICK_VELOCITY) direction = velocityPages > 0 ? 1 : -1;
      else if (Math.abs(projected) >= PAGE_COMMIT_FRACTION) direction = projected > 0 ? 1 : -1;

      // The release velocity is handed straight to the spring, so the settle
      // continues the drag rather than starting a second animation.
      const base = baseIdx.get();
      settleTo(clamp(origin + direction, base - 1, base + 1), velocityPages);
    })
    .onFinalize(() => {
      "worklet";
      panActive.set(0);
    });

  return (
    <View
      onLayout={(event) => {
        const measured = event.nativeEvent.layout.width;
        pageWidth.set(measured);
        setWidth((previous) => (previous === measured ? previous : measured));
      }}
    >
      <View style={[styles.navRow, { height: NAV_ROW_HEIGHT }]}>
        <Pressable onPress={() => stepMonth(-1)} accessibilityRole="button" accessibilityLabel="Previous month" hitSlop={10}>
          <Text style={[styles.navGlyph, { color: colors.textSecondary }]}>‹</Text>
        </Pressable>
        <Text style={[typography.subtitle, { color: colors.textPrimary }]}>{monthYearLabel(headerMonth)}</Text>
        <Pressable onPress={() => stepMonth(1)} accessibilityRole="button" accessibilityLabel="Next month" hitSlop={10}>
          <Text style={[styles.navGlyph, { color: colors.textSecondary }]}>›</Text>
        </Pressable>
      </View>

      <View style={[styles.viewport, { height: CALENDAR_MONTH_GRID_HEIGHT }]}>
        {width === 0 ? null : (
          <GestureDetector gesture={pan}>
            <View style={styles.fill} collapsable={false}>
              {/* Previous, current and next stay mounted throughout a drag
                  and its settle. Each one places itself from its own page
                  index, so the set can change at commit without moving the
                  pages that survive it. */}
              {PAGE_OFFSETS.map((offset) => {
                const pageIndex = settled.index + offset;
                const month = addMonthsIso(anchorMonth, pageIndex);
                return (
                  <MonthPage
                    key={month}
                    month={month}
                    pageIndex={pageIndex}
                    pos={pos}
                    width={width}
                    value={value}
                    today={today}
                    onSelect={handleSelect}
                  />
                );
              })}
            </View>
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
  fill: {
    flex: 1,
  },
});
