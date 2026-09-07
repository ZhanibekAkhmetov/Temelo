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
import { addMonthsIso } from "@/domain/calendar";
import {
  MONTH_PAGE_SPRING,
  PAGE_COMMIT_FRACTION,
  PAGE_FLICK_VELOCITY,
  PAGE_VELOCITY_PROJECTION_SECONDS,
  PAGER_AXIS_RATIO,
  PAGER_TOUCH_SLOP,
} from "@/features/timetable/motion";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/useTheme";

const NAV_ROW_HEIGHT = 44;
/**
 * How many months either side of the mounted window's centre are rendered.
 *
 * Two, not one, and that is a frame-rate decision rather than a correctness
 * one. A month grid is forty-two touchable cells; mounting one costs a real
 * commit, and while the window was only ±1 that commit landed *during* the
 * settle — the mounted set followed the month in view, which changes at the
 * midpoint of the animation. Every single swipe therefore built a month while
 * a spring was running, which is exactly the stutter that showed up as "fast
 * but low fps".
 *
 * At ±2 the page being swiped towards is already there, and the window is
 * re-centred once the pager has come to rest, when there is no animation left
 * to disturb. Two consecutive fast swipes still stay inside it.
 */
const MOUNT_RADIUS = 2;
const PAGE_OFFSETS = [-2, -1, 0, 1, 2];

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
 * - the month on screen is read back from where the pager actually is rather
 *   than counted in steps, so it cannot drift.
 *
 * Where it differs from the week pager is arbitration and pace, because it is
 * a small control inside a scrolling form rather than a whole screen — see
 * `pan` and `dominant` below.
 */
export function MonthPager({ value, today, onSelect }: MonthPagerProps) {
  const { colors, typography } = useTheme();
  const { t, format } = useI18n();
  const [width, setWidth] = useState(0);

  /**
   * The page nearest the eye — which is both the month the heading names and
   * the centre of the mounted window.
   *
   * These used to be two different numbers: the heading followed the dominant
   * page, while the mounted set followed a *committed* index that only
   * advanced when a spring ran all the way to its end. A second swipe started
   * before the first had settled cancelled that spring, so nothing ever
   * committed, so the mounted window never moved — and the drag clamp, which
   * is bounded by that window, refused to let the pager leave the month it was
   * already on. The gesture was tracked, released, and quietly discarded. That
   * is the whole of "rapid month swipes are not reliably accepted".
   *
   * One number fixes it. The dominant page changes on the midpoint crossing,
   * which is early enough that the page being swiped towards is mounted well
   * before the finger gets there, and it is unaffected by whether any
   * particular animation was allowed to finish.
   */
  const [dominant, setDominant] = useState(0);

  /**
   * Bumped by every settle that ran to completion. Only the queued-arrow drain
   * hangs off it; nothing visual does.
   */
  const [settleTick, setSettleTick] = useState(0);

  // Months are addressed relative to the month the field opened on.
  const [anchorMonth] = useState(value);
  const headerMonth = addMonthsIso(anchorMonth, dominant);

  /** Continuous page position, in months. */
  const pos = useSharedValue(0);
  const panStartPos = useSharedValue(0);
  const panActive = useSharedValue(0);
  /** Page width, mirrored where worklets can read it without capturing state. */
  const pageWidth = useSharedValue(0);
  /**
   * The centre of the *mounted* window, as React has actually committed it.
   *
   * Written from an effect rather than from the state update that moves it, so
   * it can never be ahead of the pages that exist: the clamp below is what
   * stops a drag reaching a page that has not been rendered yet, and a bound
   * derived from a state update still in flight would not stop anything.
   */
  const mountedIdx = useSharedValue(0);
  /** The whole page the pager is heading for; only a starting spring moves it. */
  const targetIdx = useSharedValue(0);

  /** Which axis the current touch belongs to: 0 undecided, 1 ours, 2 the form's. */
  const claim = useSharedValue(0);
  const touchStartX = useSharedValue(0);
  const touchStartY = useSharedValue(0);

  /**
   * Arrow presses that arrived before their destination page was mounted.
   * A shared value rather than a ref: a drag clears the queue from its own
   * worklet, and the gesture is built during render.
   */
  const queuedSteps = useSharedValue(0);

  /**
   * The centre of the mounted window, moved as rarely as it can be.
   *
   * Re-centred by `commitSettled` — when the pager has come to rest and the
   * commit that mounts a month costs nothing — with one safety valve below for
   * a run of swipes fast enough that nothing ever settles.
   */
  const [windowCentre, setWindowCentre] = useState(0);

  const showDominant = useCallback((index: number) => {
    setDominant((previous) => (previous === index ? previous : index));
    // The valve: only once the month in view has reached the edge of what is
    // mounted, so an ordinary swipe never triggers it.
    setWindowCentre((previous) => (Math.abs(index - previous) < MOUNT_RADIUS ? previous : index));
  }, []);

  /**
   * The month in view, resolved by rounding the shared position — so it
   * changes exactly when the *nearest* page changes, once, on the midpoint
   * crossing. Everything between crossings stays on the UI thread: React is
   * only told when the answer is genuinely different, so a drag costs at most
   * one render per month boundary it passes over, in either direction.
   */
  useAnimatedReaction(
    () => Math.round(pos.get()),
    (nearest, previous) => {
      if (nearest === previous) return;
      runOnJS(showDominant)(nearest);
    },
  );

  // After the render that mounts them, and not before.
  useEffect(() => {
    mountedIdx.set(windowCentre);
  }, [windowCentre, mountedIdx]);

  const commitSettled = useCallback(() => {
    // The pager has stopped, so this is the cheapest possible moment to build
    // whatever month has come within reach.
    setWindowCentre(Math.round(pos.get()));
    setSettleTick((previous) => previous + 1);
  }, [pos]);

  /**
   * Every page change goes through here — swipe release, arrow press and
   * queued arrow press alike — so all three settle identically.
   */
  const settleTo = useCallback(
    (target: number, velocity: number) => {
      "worklet";
      targetIdx.set(target);
      pos.set(
        withSpring(target, { ...MONTH_PAGE_SPRING, velocity }, (finished) => {
          if (finished) runOnJS(commitSettled)();
        }),
      );
    },
    [commitSettled, pos, targetIdx],
  );

  /**
   * Release one queued arrow press, when there is somewhere to release it to.
   *
   * Driven by two things: a settle landing, and the month in view changing.
   * The second is what keeps a run of fast taps moving — the next page is
   * mounted at the midpoint of the current animation, so the following step
   * can start there rather than waiting for the spring to finish arriving.
   *
   * The mounted-window guard is what makes that safe: a step that would land
   * on a page which does not exist yet stays in the queue, and the very change
   * that mounts that page runs this effect again. `mountedIdx` is written by
   * the effect declared above this one, so within a single commit it has
   * already caught up before this reads it.
   */
  useEffect(() => {
    const queued = queuedSteps.get();
    if (queued === 0 || panActive.get() === 1) return;

    const direction = Math.sign(queued);
    const next = Math.round(targetIdx.get()) + direction;
    if (Math.abs(next - mountedIdx.get()) > MOUNT_RADIUS) return;

    queuedSteps.set(queued - direction);
    settleTo(next, 0);
  }, [mountedIdx, panActive, queuedSteps, settleTick, windowCentre, settleTo, targetIdx]);

  const stepMonth = useCallback(
    (direction: number) => {
      // The finger owns the pager while it is down; an arrow must not fight it.
      if (panActive.get() === 1) return;

      const target = targetIdx.get() + direction;
      // Only the month in view and its neighbours are mounted, so a press that
      // outruns the animation waits for it rather than sliding towards a page
      // that is not there yet.
      if (Math.abs(target - mountedIdx.get()) > MOUNT_RADIUS) {
        queuedSteps.set(clamp(queuedSteps.get() + direction, -MAX_QUEUED_STEPS, MAX_QUEUED_STEPS));
        return;
      }
      settleTo(target, 0);
    },
    [mountedIdx, panActive, queuedSteps, settleTo, targetIdx],
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

  /**
   * First-intent arbitration between this pager and the form scrolling behind
   * it, decided once per touch and then held.
   *
   * `activeOffsetX` / `failOffsetY` cannot express this. They are independent
   * thresholds, so a swipe that travels 40 points across and 11 down — an
   * entirely ordinary thumb swipe — trips the vertical *failure* before the
   * horizontal activation and is handed to the form, which then scrolls the
   * whole page instead of turning the month. That is the "swipes get stolen"
   * and "you have to move slowly and precisely" complaint, and it is a
   * property of the thresholds rather than of the gesture.
   *
   * Comparing the two displacements instead asks the question that actually
   * matters — which direction is this mostly going — at a slop small enough
   * that neither party has visibly started. Once decided, the claim is fixed
   * for the rest of the sequence: `manager.activate()` cancels the form's
   * touch, and a pan that has activated is not something the ScrollView can
   * take back midway.
   */
  const pan = Gesture.Pan()
    .maxPointers(1)
    .manualActivation(true)
    .onTouchesDown((event) => {
      "worklet";
      const touch = event.allTouches[0];
      touchStartX.set(touch.x);
      touchStartY.set(touch.y);
      claim.set(0);
    })
    .onTouchesMove((event, manager) => {
      "worklet";
      if (claim.get() !== 0) return;

      const touch = event.allTouches[0];
      const dx = Math.abs(touch.x - touchStartX.get());
      const dy = Math.abs(touch.y - touchStartY.get());
      if (Math.max(dx, dy) < PAGER_TOUCH_SLOP) return;

      if (dx > dy * PAGER_AXIS_RATIO) {
        claim.set(1);
        manager.activate();
        return;
      }
      // Clearly vertical, or too ambiguous to take: the form gets it, at once
      // rather than after this gesture has held the touch for a while.
      claim.set(2);
      manager.fail();
    })
    .onStart(() => {
      "worklet";
      /*
       * A settle already running is taken over rather than waited for.
       *
       * `cancelAnimation` leaves `pos` wherever the spring had got to, and the
       * drag continues from there — so a second swipe that arrives mid-flight
       * is a continuation of the first rather than a competing animation, and
       * the month identity stays whatever the position says it is. The
       * cancelled spring commits nothing; this drag's own settle commits in
       * its place.
       */
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
      /*
       * One month per gesture, and never past a page that is not mounted.
       *
       * The first bound is the product rule: a swipe turns one month. The
       * second is a rendering fact, and it is deliberately measured from the
       * month *in view* — which is mounted, by definition — rather than from a
       * committed index that a cancelled animation may have left behind.
       */
      const origin = Math.round(panStartPos.get());
      const mounted = mountedIdx.get();
      const low = Math.max(origin - 1, mounted - MOUNT_RADIUS);
      const high = Math.min(origin + 1, mounted + MOUNT_RADIUS);
      pos.set(clamp(panStartPos.get() - event.translationX / size, low, high));
    })
    .onEnd((event, success) => {
      "worklet";
      const size = pageWidth.get();
      // Measured from the page the drag started on, not from the month in
      // view: mid-settle those differ, and the drag's own origin is the honest
      // one to judge its travel against.
      const origin = Math.round(panStartPos.get());

      if (!success || size <= 0) {
        // Cut short rather than released — a second finger, most likely.
        // Back to where the drag began, changing nothing.
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
      const mounted = mountedIdx.get();
      settleTo(clamp(origin + direction, mounted - MOUNT_RADIUS, mounted + MOUNT_RADIUS), velocityPages);
    })
    .onFinalize(() => {
      "worklet";
      panActive.set(0);
      claim.set(0);
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
        <MonthArrow glyph="‹" label={t("datePicker.previousMonth")} color={colors.textSecondary} onPress={() => stepMonth(-1)} />
        <Text style={[typography.subtitle, styles.heading, { color: colors.textPrimary }]} numberOfLines={1}>
          {format.monthYear(headerMonth)}
        </Text>
        <MonthArrow glyph="›" label={t("datePicker.nextMonth")} color={colors.textSecondary} onPress={() => stepMonth(1)} />
      </View>

      <View style={[styles.viewport, { height: CALENDAR_MONTH_GRID_HEIGHT }]}>
        {width === 0 ? null : (
          <GestureDetector gesture={pan}>
            <View style={styles.fill} collapsable={false}>
              {/* Previous, current and next stay mounted throughout a drag
                  and its settle. Each one places itself from its own page
                  index, so the set can change as the pager moves without
                  moving the pages that survive it. */}
              {PAGE_OFFSETS.map((offset) => {
                const pageIndex = windowCentre + offset;
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

/**
 * One of the two month arrows.
 *
 * The glyph is small on purpose — it is a chevron, not a button — so the
 * target is built around it rather than out of it: a 44-point box, plus enough
 * `hitSlop` to reach the edges of the row without meeting the other arrow
 * across the month name. `pressRetentionOffset` is what makes a quick repeated
 * tap actually count: a finger that slides a few points while pressing has not
 * changed its mind, and cancelling on that is why the arrows felt unreliable.
 */
function MonthArrow({
  glyph,
  label,
  color,
  onPress,
}: {
  glyph: string;
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
      pressRetentionOffset={{ top: 20, bottom: 20, left: 12, right: 12 }}
      style={({ pressed }) => [styles.arrowTarget, { opacity: pressed ? 0.5 : 1 }]}
    >
      <Text style={[styles.navGlyph, { color }]}>{glyph}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  arrowTarget: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  navGlyph: {
    fontSize: 22,
    lineHeight: 26,
  },
  // Takes the space between the arrows and centres in it, so a long month
  // name — "Сентябрь 2026" — never pushes an arrow off the row.
  heading: {
    flex: 1,
    textAlign: "center",
  },
  viewport: {
    overflow: "hidden",
  },
  fill: {
    flex: 1,
  },
});
