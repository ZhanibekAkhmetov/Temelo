import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { BackHandler, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { cancelAnimation, runOnJS, useSharedValue, withDecay, withSpring } from "react-native-reanimated";

import { addWeeksIso, weekDatesFrom } from "@/domain/calendar";
import type { EditSource } from "@/domain/classEdit";
import type { OccurrencePreview } from "@/domain/occurrence";
import { findCurrentPeriodIndex } from "@/domain/time";
import { resolveWeekBlocks, type ScheduledClass, type WeekBlock } from "@/domain/timetable";
import type { Weekday } from "@/domain/week";
import {
  clampValue,
  columnWidthForZoom,
  DAY_HEADER_HEIGHT,
  maxOffsetXFor,
  maxScrollFor,
  maxZoomFor,
  slotHeightForZoom,
  TIME_GUTTER_WIDTH,
} from "@/features/timetable/geometry";
import { HANDLE_TOUCH_RADIUS } from "@/features/timetable/GridBlock";
import {
  IDLE,
  INTERACTION,
  isManipulating,
  type Interaction,
  type RangeGeometry,
} from "@/features/timetable/interaction";
import { ManipulationOverlay, type ManipulationSubject } from "@/features/timetable/ManipulationOverlay";
import {
  AXIS,
  BLOCK_LONG_PRESS_MS,
  PAGE_COMMIT_FRACTION,
  PAGE_FLICK_VELOCITY,
  PAGE_SPRING,
  PAGE_VELOCITY_PROJECTION_SECONDS,
  SCROLL_DECELERATION,
  TAP_MAX_DURATION_MS,
  TOUCH_SLOP,
} from "@/features/timetable/motion";
import { TimeGutter } from "@/features/timetable/TimeGutter";
import type { HitBlock, PageOverlay, SelectedCell } from "@/features/timetable/types";
import { WeekPage } from "@/features/timetable/WeekPage";
import { activationTick, selectionTick } from "@/util/haptics";
import type { Course, OccurrenceException, Placement, TimeSlot } from "@/types/models";

/**
 * What a touch landed on. The pan decides this once, at finger-down, while
 * the geometry is still static, so its slop-crossing choice is a lookup
 * rather than a hit-test against a surface that may since have moved.
 */
const TARGET_CHROME = 0;
const TARGET_EMPTY = 1;
const TARGET_BLOCK = 2;
const TARGET_HANDLE_START = 3;
const TARGET_HANDLE_END = 4;

/**
 * What the one-finger gesture turned out to be. Decided once and then held
 * for the rest of the gesture. Everything from `PAN_CREATE` upwards shapes a
 * range and is driven from the touch callbacks rather than from an activated
 * pan, so it can never compete with the scroller for activation.
 */
const PAN_NONE = 0;
/**
 * The two horizontal gestures, chosen once and never exchanged.
 *
 * `PAN_PAGE` is claimed only when there is nowhere left to go inside the
 * week — either it fits entirely, or it is already pushed against the edge
 * the finger is heading for. `PAN_WEEK` is the zoomed-in case: it shifts
 * the week inside its own page and stops dead at either end, so running out
 * of week can never turn into changing week without lifting first.
 */
const PAN_PAGE = 1;
const PAN_WEEK = 2;
const PAN_SCROLL = 3;
const PAN_CREATE = 4;
const PAN_RESIZE_START = 5;
const PAN_RESIZE_END = 6;
const PAN_MOVE = 7;

/** Sub-pixel slack that still counts as being against an edge. */
const EDGE_EPSILON = 0.5;

/**
 * How far into the neighbouring period a dragged resize handle must reach
 * before the block takes that period on, or gives it up.
 */
const RESIZE_SNAP_FRACTION = 0.75;

/**
 * Below this, a pinch ended at the scale it started at and there is nothing
 * to commit. Deliberately near-exact rather than a comfortable tolerance:
 * skipping the commit leaves the transform to be neutralised on its own,
 * and any scale it is still carrying becomes a displacement multiplied by
 * how far down the grid a row sits. At a thousandth, the bottom of a long
 * day would shift by around three points — small, but exactly the kind of
 * jump this whole path exists to prevent.
 */
const SCALE_EPSILON = 1e-6;

/**
 * Read once, here, rather than inside the worklet: `__DEV__` is a bundler
 * global on the JavaScript context, and a worklet runs on its own runtime.
 * Captured in the closure it is a plain boolean either way.
 */
const instrumentHandoff = __DEV__;

/** Anything above this, in points, would be a hand-over the eye can see. */
const HANDOFF_TOLERANCE = 0.5;

interface ZoomHandoff {
  anchorSlot: number;
  anchorColumn: number;
  beforeX: number;
  beforeY: number;
  afterX: number;
  afterY: number;
  scrollY: number;
  offsetX: number;
  settledHeightBefore: number;
  settledWidthBefore: number;
  settledHeightAfter: number;
  settledWidthAfter: number;
  scaleX: number;
  scaleY: number;
}

/**
 * Says, in development only, whether a finished pinch moved the grid.
 *
 * The point the fingers were holding is projected onto the screen twice —
 * once through the transform that was drawing it, once through the settled
 * layout that replaces it — and the two are compared. Silent means the
 * hand-over was invisible; anything printed is a real displacement, in
 * points, with the geometry that produced it.
 */
function reportZoomHandoff(sample: ZoomHandoff): void {
  const driftX = sample.afterX - sample.beforeX;
  const driftY = sample.afterY - sample.beforeY;
  if (Math.abs(driftX) <= HANDOFF_TOLERANCE && Math.abs(driftY) <= HANDOFF_TOLERANCE) return;
  console.warn(
    `[timetable] pinch hand-over moved the grid by ${driftX.toFixed(2)}×${driftY.toFixed(2)}pt`,
    JSON.stringify(sample),
  );
}

const PAGE_OFFSETS = [-1, 0, 1];

export interface TimetableSurfaceHandle {
  goToRelativeWeek: (offset: number) => void;
  goToCurrentWeek: () => void;
  /**
   * Closes out a drag whose commit was deferred to a scope choice: `revert`
   * puts the selection back where the drag started, otherwise the edit is
   * done and nothing stays selected.
   */
  settleDeferredDrag: (revert: boolean) => void;
}

interface TimetableSurfaceProps {
  /** Week the page range is centred on; index 0 is the current week. */
  anchorWeekStart: string;
  weekdays: Weekday[];
  timeSlots: TimeSlot[];
  placements: Placement[];
  courses: Course[];
  exceptions: OccurrenceException[];
  /** An edit awaiting a scope choice, drawn where it would land. */
  preview: OccurrencePreview | null;
  today: string;
  now: string;
  onVisibleWeekChange: (weekStartIso: string) => void;
  onOpenEditor: (selection: SelectedCell) => void;
  /**
   * A settled drag or resize. Returns "deferred" when it opened a question
   * instead of changing anything, so the surface knows to keep the origin
   * for a possible cancel.
   */
  onMoveClass: (move: OccurrenceMove) => MoveOutcome;
  /** Whether a proposed position is free for a whole series' recurrence. */
  canPlaceClass: (input: PlacementPosition) => boolean;
  /** The same, asked of one date only — one occurrence, or a new range. */
  canPlaceOccurrence: (input: OccurrencePosition) => boolean;
  ref?: Ref<TimetableSurfaceHandle>;
}

export type MoveOutcome = "committed" | "deferred";

/** Where a drag or resize left one occurrence of one class. */
export interface OccurrenceMove {
  occurrence: ScheduledClass;
  weekday: Weekday;
  timeSlotId: string;
  slotSpan: number;
  /** Date in the displayed week the block was dropped on. */
  date: string;
  source: EditSource;
}

export interface PlacementPosition {
  placementId: string;
  weekday: Weekday;
  timeSlotId: string;
  slotSpan: number;
  /** Date the dragged occurrence has in its series — where the move starts. */
  occurrenceDate: string;
  /** Destination date in the displayed week. */
  date: string;
}

/** A proposed position judged on one date: one occurrence, or a new range. */
export interface OccurrencePosition {
  /** null while the range being dragged out is not a class yet. */
  occurrenceId: string | null;
  date: string;
  timeSlotId: string;
  slotSpan: number;
}

/**
 * The whole timetable as one physical surface: weeks page horizontally,
 * time scrolls vertically, two fingers zoom both scales at once, and blocks
 * can be placed, moved and resized — all arbitrated by a single gesture
 * tree so only one of those can ever be happening at a time.
 *
 * Zoom is a single factor over the fully-zoomed-out grid, and both the
 * period height and the day-column width are derived from it. Because the
 * horizontal scale can make a week wider than its own page, the week also
 * carries an offset inside that page; horizontal drags spend that offset
 * before they start paging, which is what keeps an unzoomed swipe a plain
 * week swipe and makes leaving a zoomed week a deliberate act.
 */
export function TimetableSurface({
  anchorWeekStart,
  weekdays,
  timeSlots,
  placements,
  courses,
  exceptions,
  preview,
  today,
  now,
  onVisibleWeekChange,
  onOpenEditor,
  onMoveClass,
  canPlaceClass,
  canPlaceOccurrence,
  ref,
}: TimetableSurfaceProps) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [baseIndex, setBaseIndex] = useState(0);
  /** The single source of truth for what the user is doing. */
  const [interaction, setInteractionState] = useState<Interaction>(IDLE);
  const [subject, setSubject] = useState<ManipulationSubject | null>(null);
  /** Period height at the last settled zoom; only text layout reads it. */
  const [settledSlotHeight, setSettledSlotHeight] = useState(0);

  /**
   * The interaction as last asked for, readable the instant it is set.
   *
   * The callbacks a gesture hands its drag to have to decide what a release
   * means from state an earlier callback has only just requested, and
   * several `runOnJS` calls from one frame arrive in a single React batch —
   * a render closure would still be showing the state before the drag
   * began. A functional `setState` updater sees the right value, but it is
   * run *during the render that flushes it*, so anything it does beyond
   * returning the next state — writing to the store, above all — happens
   * mid-render. This is written in the same breath as the state instead, so
   * the callbacks can read it and stay plain event handlers.
   */
  const latestInteraction = useSharedValue<Interaction>(IDLE);
  const setInteraction = useCallback(
    (next: Interaction) => {
      latestInteraction.set(next);
      setInteractionState(next);
    },
    [latestInteraction],
  );

  const dayCount = weekdays.length;
  const slotCount = timeSlots.length;
  const bodyHeight = Math.max(0, size.height - DAY_HEADER_HEIGHT);
  const bodyWidth = Math.max(0, size.width - TIME_GUTTER_WIDTH);
  const visibleWeekStart = addWeeksIso(anchorWeekStart, baseIndex);

  /**
   * How far the pinch has been opened, as a multiple of the fully
   * zoomed-out grid. One factor drives both axes — a pinch is one gesture
   * and reads as one act — but each axis clamps itself, so whichever runs
   * out of room first simply stops while the other carries on.
   */
  const maxZoom = maxZoomFor(bodyWidth, bodyHeight, dayCount, slotCount);

  // Continuous page position in weeks; `baseIndex` is the settled one.
  const pos = useSharedValue(0);
  const scrollY = useSharedValue(0);

  /**
   * Zoom is kept in two halves, and which half is moving is the whole of
   * the pinch architecture.
   *
   * `slotHeight` and `columnWidth` are the *settled* scales. Every box on
   * the grid is laid out from them, so changing one re-measures the text
   * inside every block — real work, and exactly the work that has to happen
   * for a zoomed-in class to actually hold more of its name. They therefore
   * change once, when a pinch ends.
   *
   * `pinchScaleX` and `pinchScaleY` are the *transient* scales, and they
   * are 1 whenever nothing is being pinched. While two fingers are down
   * they carry the whole zoom as a transform on a single node per page —
   * no layout, no measurement, no React. The hand-over at the end is exact
   * rather than approximate: the settled scales are set to what the
   * transform was showing and the transform is returned to 1 in the same
   * worklet, so the frame after the pinch draws the identical picture to
   * the frame before it.
   */
  const slotHeight = useSharedValue(0);
  const columnWidth = useSharedValue(0);
  const pinchScaleX = useSharedValue(1);
  const pinchScaleY = useSharedValue(1);
  /** Both offsets are in live pixels, so the hand-over never rescales them. */
  const offsetX = useSharedValue(0);
  const zoom = useSharedValue(1);
  const baseIdx = useSharedValue(0);
  const axis = useSharedValue<number>(AXIS.none);

  const touchStartX = useSharedValue(0);
  const touchStartY = useSharedValue(0);
  // A touch that lands on still-moving content stops it instead of acting.
  const scrollSettling = useSharedValue(0);
  const offsetSettling = useSharedValue(0);
  const pageSettling = useSharedValue(0);
  const suppressTap = useSharedValue(0);
  // Raised only once a pinch has actually activated. It must never be tied
  // to the pinch beginning: a pinch handler begins on the first pointer of
  // any touch at all, so that would raise it for every tap and every drag.
  const pinchActive = useSharedValue(0);
  /**
   * Held from the moment a pinch activates until the last finger of that
   * touch sequence has left the glass, so the one left behind when the
   * other lifts cannot become a page swipe or a scroll on its way up.
   * Released by `pointerTracker`, the only handler that sees the whole
   * sequence through.
   */
  const pinchLock = useSharedValue(0);
  /** Fingers currently on the surface, counted by `pointerTracker`. */
  const pointersDown = useSharedValue(0);
  const panStartPos = useSharedValue(0);
  const panStartScroll = useSharedValue(0);
  const panStartOffsetX = useSharedValue(0);
  const pinchStartZoom = useSharedValue(1);
  const pinchStartScale = useSharedValue(1);
  const pinchAnchorSlot = useSharedValue(0);
  const pinchAnchorColumn = useSharedValue(0);
  /**
   * The last state reported by two fingers that were both still down.
   *
   * A pinch handler keeps running after the first finger leaves, and what
   * it reports then is not a smaller pinch — it is a *different* gesture
   * being measured. The grid is frozen at this instead, and the hand-over
   * at the end is made from it, so nothing that happens between the two
   * lifts can reach the screen.
   */
  const frozenScaleX = useSharedValue(1);
  const frozenScaleY = useSharedValue(1);
  const frozenScrollY = useSharedValue(0);
  const frozenOffsetX = useSharedValue(0);
  const frozenZoom = useSharedValue(1);
  /** Raised while fewer than two fingers are down, so a regained pair re-anchors. */
  const pinchRegrab = useSharedValue(0);

  const hitBlocks = useSharedValue<HitBlock[]>([]);
  /** Geometry of the current provisional/selected item, for handle hit-tests. */
  const selectionSV = useSharedValue<HitBlock | null>(null);
  /** Mirror of `interaction.kind`, so the worklets can arbitrate on it. */
  const interactionSV = useSharedValue<number>(INTERACTION.idle);

  const touchTarget = useSharedValue(TARGET_CHROME);
  const panMode = useSharedValue(PAN_NONE);
  /** Raised once a shaping drag has been handed to JavaScript to commit. */
  const dragSettled = useSharedValue(0);

  /** Where inside the block the finger grabbed it, in periods and in columns. */
  const dragGrabOffset = useSharedValue(0);
  const dragGrabDay = useSharedValue(0);
  /** How far from the boundary it belongs to a resize handle was grabbed. */
  const dragGrabEdge = useSharedValue(0);
  const dragAnchor = useSharedValue(0);
  const dragFixedEdge = useSharedValue(0);
  const dragDay = useSharedValue(0);
  const dragStart = useSharedValue(0);
  const dragSpan = useSharedValue(1);
  const labelBelow = useSharedValue(0);

  const visibleDates = useMemo(() => weekDatesFrom(visibleWeekStart), [visibleWeekStart]);
  const visibleBlocks = useMemo(
    () => resolveWeekBlocks({ weekdays, dates: visibleDates, placements, courses, exceptions, timeSlots, preview }),
    [weekdays, visibleDates, placements, courses, exceptions, timeSlots, preview],
  );

  // Hit-testing data for the gesture worklets: only the week on screen can
  // be touched, so only that week's blocks are published.
  useEffect(() => {
    hitBlocks.set(
      visibleBlocks.map((block) => ({
        occurrenceId: block.occurrenceId,
        dayIndex: block.dayIndex,
        startIndex: block.startIndex,
        span: block.span,
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleBlocks]);

  // Everything the worklets need to know about the single active item.
  useEffect(() => {
    interactionSV.set(INTERACTION[interaction.kind]);
    const onVisibleWeek = interaction.kind !== "idle" && interaction.weekStart === visibleWeekStart;
    selectionSV.set(
      onVisibleWeek && (interaction.kind === "provisionalSelected" || interaction.kind === "eventSelected")
        ? {
            occurrenceId: interaction.kind === "eventSelected" ? interaction.occurrenceId : null,
            dayIndex: interaction.dayIndex,
            startIndex: interaction.startIndex,
            span: interaction.span,
          }
        : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interaction, visibleWeekStart]);

  // Zoom starts fully out and is only re-derived when the viewport or the
  // academic day changes — a finished pinch keeps whatever it produced.
  const hasPositioned = useRef(false);
  useEffect(() => {
    if (bodyHeight <= 0 || bodyWidth <= 0 || slotCount <= 0 || dayCount <= 0) return;

    // The zoom factor survives a rotation or a change to the academic day;
    // the two scales are re-derived from it against the new geometry, which
    // is what keeps "fully zoomed out" meaning the whole week either way.
    const nextZoom = hasPositioned.current ? clampValue(zoom.get(), 1, maxZoom) : 1;
    const nextHeight = slotHeightForZoom(nextZoom, bodyHeight, slotCount);
    const nextWidth = columnWidthForZoom(nextZoom, bodyWidth, dayCount);
    zoom.set(nextZoom);
    slotHeight.set(nextHeight);
    columnWidth.set(nextWidth);
    // The settled scales now hold the whole zoom again. If a pinch were
    // somehow still in flight — a rotation mid-gesture is the only way —
    // leaving a transient scale on top of them would draw it twice.
    pinchScaleX.set(1);
    pinchScaleY.set(1);
    setSettledSlotHeight(nextHeight);

    if (!hasPositioned.current) {
      hasPositioned.current = true;
      const focusIndex = findCurrentPeriodIndex(timeSlots, now);
      scrollY.set(clampValue(focusIndex * nextHeight - bodyHeight / 3, 0, maxScrollFor(nextHeight, slotCount, bodyHeight)));
      offsetX.set(0);
      return;
    }

    scrollY.set(clampValue(scrollY.get(), 0, maxScrollFor(nextHeight, slotCount, bodyHeight)));
    offsetX.set(clampValue(offsetX.get(), 0, maxOffsetXFor(nextWidth, dayCount, bodyWidth)));
    // `now` only seeds the first position; later ticks must not scroll the grid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyHeight, bodyWidth, dayCount, maxZoom, slotCount, timeSlots]);

  /**
   * The period height as of the last settled zoom.
   *
   * How many lines of a class name a block can hold is a text-layout
   * question, and text layout is not something a worklet can re-decide per
   * frame. So it is answered once, after a pinch has finished, and the
   * height is handed in rather than read back — this arrives a render or
   * two after the geometry has already settled, and reading the shared
   * value then could pick up a later one.
   */
  const commitSettledZoom = useCallback((height: number) => {
    setSettledSlotHeight((previous) => (Math.abs(height - previous) < 1 ? previous : height));
  }, []);

  /**
   * Brings the committed week into line with the page the pager is actually
   * resting on. Every settle ends here, however it got there.
   *
   * This is deliberately absolute and idempotent rather than "advance by
   * one, if the animation reported that it finished". A page spring is
   * cancelled routinely — a second swipe during the settle, an arrow press,
   * a pinch that freezes the pager — and a relative commit that only runs on
   * a clean finish is simply dropped when that happens. The pager still ends
   * up on the new page, so the week on screen and the week the rest of this
   * component believes in drift apart, and stay apart: hit-testing,
   * `visibleBlocks` and the editor all keep answering for the previous week
   * while the user looks at the next one. Re-deriving the week from where
   * the pager truly is cannot drift.
   */
  const reconcilePage = useCallback(() => {
    const settled = Math.round(pos.get());
    if (settled === baseIdx.get()) return;
    baseIdx.set(settled);
    setBaseIndex(settled);
    onVisibleWeekChange(addWeeksIso(anchorWeekStart, settled));
  }, [anchorWeekStart, baseIdx, onVisibleWeekChange, pos]);

  /**
   * A week that is being left behind takes its horizontal position with it.
   *
   * Wherever the reader had scrolled to inside the old week — Friday, most
   * likely, since that is the end you have to reach before you may page at
   * all — the new one opens at its first day. Anything else means arriving
   * in the middle of a week you have not looked at yet.
   *
   * It rides the page spring rather than being set on arrival: the two
   * weeks share one offset, so snapping it would visibly drag the outgoing
   * week sideways while it is still most of the way on screen. Sprung
   * together, the content simply comes to rest at Monday as the page does.
   */
  const returnToWeekStart = useCallback(() => {
    "worklet";
    if (offsetX.get() === 0) return;
    offsetSettling.set(1);
    offsetX.set(
      withSpring(0, PAGE_SPRING, () => {
        offsetSettling.set(0);
      }),
    );
  }, [offsetSettling, offsetX]);

  const goToPage = useCallback(
    (target: number) => {
      // Measured from where the pager is, not from the last committed week:
      // during a settle those differ, and the committed one is the stale half.
      const from = Math.round(pos.get());
      const distance = target - from;
      if (distance === 0) return;

      // Only the neighbouring weeks are mounted, so anything further away
      // is a jump rather than a slide: position and week change together
      // and the destination is rendered directly.
      if (Math.abs(distance) > 1) {
        pos.set(target);
        offsetX.set(0);
        reconcilePage();
        return;
      }

      // One week away is the same animation and the same settlement path a
      // swipe takes: spring first, reconcile the logical week on arrival.
      pageSettling.set(1);
      pos.set(
        withSpring(from + Math.sign(distance), PAGE_SPRING, () => {
          pageSettling.set(0);
          runOnJS(reconcilePage)();
        }),
      );
      returnToWeekStart();
    },
    [offsetX, pageSettling, pos, reconcilePage, returnToWeekStart],
  );

  /**
   * Where a drag that has not been committed yet started, kept only for as
   * long as the scope question is open — it is what "Cancel" puts back.
   *
   * A shared value rather than a ref for the same reason `latestInteraction`
   * is one: it is written from the callback a gesture hands its release to,
   * which is reachable from worklets built during render.
   */
  const deferredOrigin = useSharedValue<{ occurrenceId: string; origin: RangeGeometry } | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      goToRelativeWeek: (offset: number) => goToPage(Math.round(pos.get()) + offset),
      goToCurrentWeek: () => goToPage(0),
      settleDeferredDrag: (revert: boolean) => {
        const deferred = deferredOrigin.get();
        deferredOrigin.set(null);
        // Committed edits leave nothing selected: after a series split the
        // occurrence under the selection is no longer the one that was
        // dragged, and a stale selection would offer handles for it.
        if (!revert || !deferred) {
          setInteraction(IDLE);
          return;
        }
        setInteraction({ kind: "eventSelected", occurrenceId: deferred.occurrenceId, ...deferred.origin });
      },
    }),
    [deferredOrigin, goToPage, pos, setInteraction],
  );

  /**
   * The week the user is actually looking at, resolved at the moment it is
   * asked for.
   *
   * The pages are *mounted* from `baseIndex` but *positioned* from `pos`, so
   * whenever those two disagree the page that slides into the middle is a
   * neighbour, drawing a week that `visibleWeekStart` does not name. The
   * grid looks perfectly right while every lookup keyed on the committed
   * week answers for the page that just left the screen — which is how a tap
   * on an empty slot could open the editor of a class that is not there.
   *
   * `pos` is the same value the pages place themselves by, so reading it
   * here asks the one question that cannot be a render behind: which page is
   * under the finger. Only gestures use this, and only once each, so
   * re-resolving a single week is not on any hot path.
   */
  const pageUnderFinger = useCallback(() => {
    const weekStart = addWeeksIso(anchorWeekStart, Math.round(pos.get()));
    const dates = weekDatesFrom(weekStart);
    return {
      weekStart,
      dates,
      blocks: resolveWeekBlocks({ weekdays, dates, placements, courses, exceptions, timeSlots, preview }),
    };
  }, [anchorWeekStart, courses, exceptions, placements, pos, preview, timeSlots, weekdays]);

  /**
   * Whether a proposed range is free.
   *
   * A whole series is checked against recurrence overlap, because it has to
   * hold on every date it meets. A single occurrence that has already
   * stepped out of its series — and a range that is not a class yet — only
   * has to be free on the one date on screen.
   *
   * Both questions go to the store, and from there to the same domain
   * helpers creation and the scope-apply use. Judging the drag from the
   * blocks drawn in the visible week instead would be a second, move-only
   * rule: a week where an alternating class simply does not meet looks
   * identical to one where it does not clash.
   */
  const rangeIsFree = useCallback(
    (occurrenceId: string | null, dayIndex: number, startIndex: number, span: number): boolean => {
      if (dayIndex < 0 || dayIndex >= dayCount || startIndex < 0 || startIndex + span > slotCount) return false;

      const page = pageUnderFinger();
      const weekday = weekdays[dayIndex];
      const date = page.dates[weekday];
      const timeSlotId = timeSlots[startIndex].id;

      const subject = occurrenceId ? page.blocks.find((block) => block.occurrenceId === occurrenceId) : undefined;
      if (subject && !subject.exception) {
        return canPlaceClass({
          placementId: subject.basePlacement.id,
          weekday,
          timeSlotId,
          slotSpan: span,
          occurrenceDate: subject.occurrenceDate,
          date,
        });
      }
      return canPlaceOccurrence({ occurrenceId, date, timeSlotId, slotSpan: span });
    },
    [canPlaceClass, canPlaceOccurrence, dayCount, pageUnderFinger, slotCount, timeSlots, weekdays],
  );

  const openEditorFor = useCallback(
    (dates: Record<Weekday, string>, dayIndex: number, startIndex: number, span: number, existing?: WeekBlock) => {
      const weekday = weekdays[dayIndex];
      setInteraction(IDLE);
      onOpenEditor({
        weekday,
        date: dates[weekday],
        timeSlot: timeSlots[startIndex],
        slotSpan: span,
        endTime: timeSlots[Math.min(slotCount - 1, startIndex + span - 1)].endTime,
        existing,
      });
    },
    [onOpenEditor, setInteraction, slotCount, timeSlots, weekdays],
  );

  /**
   * The provisional block is a suggestion, not a commitment: anything that
   * says "I meant to look somewhere else" — scrolling, paging, pinching —
   * takes it away again. A selected class is left alone by those, because
   * scrolling to its handles is part of resizing it.
   */
  const dismissProvisional = useCallback(() => {
    if (latestInteraction.get().kind === "provisionalSelected") setInteraction(IDLE);
  }, [latestInteraction, setInteraction]);

  /** Android Back clears whatever is provisional or selected before it leaves. */
  useEffect(() => {
    if (interaction.kind === "idle") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setInteraction(IDLE);
      return true;
    });
    return () => subscription.remove();
  }, [interaction.kind, setInteraction]);

  /**
   * idle | provisionalSelected | eventSelected --tap-->
   *   on a class            -> open its editor
   *   on the active item    -> open its editor
   *   on empty grid         -> provisionalSelected (replacing any previous)
   *   anywhere else         -> idle
   */
  const handleTap = useCallback(
    (x: number, y: number) => {
      const width = columnWidth.get();
      if (width <= 0 || slotHeight.get() <= 0) return;
      const dayIndex = Math.floor((x - TIME_GUTTER_WIDTH + offsetX.get()) / width);
      const slotIndex = Math.floor((y - DAY_HEADER_HEIGHT + scrollY.get()) / slotHeight.get());
      const onGrid =
        y >= DAY_HEADER_HEIGHT &&
        x >= TIME_GUTTER_WIDTH &&
        dayIndex >= 0 &&
        dayIndex < dayCount &&
        slotIndex >= 0 &&
        slotIndex < slotCount;

      if (!onGrid) {
        setInteraction(IDLE);
        return;
      }

      // Resolved from the pager itself, so the class this tap is judged
      // against is the one actually drawn under it.
      const page = pageUnderFinger();
      const existing = page.blocks.find(
        (block) => block.dayIndex === dayIndex && slotIndex >= block.startIndex && slotIndex < block.startIndex + block.span,
      );
      if (existing) {
        openEditorFor(page.dates, existing.dayIndex, existing.startIndex, existing.span, existing);
        return;
      }

      const active = interaction;
      const insideActive =
        (active.kind === "provisionalSelected" || active.kind === "eventSelected") &&
        active.weekStart === page.weekStart &&
        active.dayIndex === dayIndex &&
        slotIndex >= active.startIndex &&
        slotIndex < active.startIndex + active.span;

      if (insideActive && active.kind === "provisionalSelected") {
        openEditorFor(page.dates, active.dayIndex, active.startIndex, active.span);
        return;
      }

      setInteraction({ kind: "provisionalSelected", weekStart: page.weekStart, dayIndex, startIndex: slotIndex, span: 1 });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dayCount, interaction, openEditorFor, pageUnderFinger, setInteraction, slotCount],
  );

  /** idle | provisionalSelected --long press on empty grid--> creatingRange */
  const beginCreateRange = useCallback(
    (dayIndex: number, anchorIndex: number) => {
      activationTick();
      setSubject(null);
      setInteraction({
        kind: "creatingRange",
        weekStart: pageUnderFinger().weekStart,
        dayIndex,
        anchorIndex,
        startIndex: anchorIndex,
        span: 1,
        valid: rangeIsFree(null, dayIndex, anchorIndex, 1),
      });
    },
    [pageUnderFinger, rangeIsFree, setInteraction],
  );

  /** eventSelected --handle drag--> resizingStart | resizingEnd */
  const beginResize = useCallback(
    (edge: "start" | "end", occurrenceId: string, dayIndex: number, startIndex: number, span: number) => {
      const page = pageUnderFinger();
      const origin: RangeGeometry = { weekStart: page.weekStart, dayIndex, startIndex, span };
      const block = page.blocks.find((candidate) => candidate.occurrenceId === occurrenceId);
      setSubject(
        block
          ? { occurrenceId, name: block.course.name, room: block.course.room, appearanceId: block.course.appearanceId }
          : { occurrenceId },
      );
      setInteraction({
        kind: edge === "start" ? "resizingStart" : "resizingEnd",
        occurrenceId,
        origin,
        weekStart: page.weekStart,
        dayIndex,
        startIndex,
        span,
        valid: true,
      });
    },
    [pageUnderFinger, setInteraction],
  );

  /**
   * idle | provisionalSelected | eventSelected --long press on a class--> movingEvent
   *
   * The hold *is* the pick-up. It does not select and wait to be held a
   * second time: the finger is already down, the haptic has already said
   * the class has been taken, and the natural next thing to do is move it.
   * Selecting is what a move that goes nowhere settles into, which is why
   * `finishManipulation` returns an unchanged drag to `eventSelected` and
   * its handles — so the resize path costs one hold and a release, and the
   * move path costs one hold and no release at all.
   */
  const beginMove = useCallback(
    (occurrenceId: string, dayIndex: number, startIndex: number, span: number) => {
      activationTick();
      const page = pageUnderFinger();
      const block = page.blocks.find((candidate) => candidate.occurrenceId === occurrenceId);
      // The worklet hit-tests against `hitBlocks`, which is published from an
      // effect and so describes the previous render. A hold that lands on a
      // class the week on screen does not actually contain is that lag, not
      // an intention: picking it up would drag a block nobody can see.
      if (!block) {
        setInteraction(IDLE);
        return;
      }
      setSubject({ occurrenceId, name: block.course.name, room: block.course.room, appearanceId: block.course.appearanceId });
      setInteraction({
        kind: "movingEvent",
        occurrenceId,
        origin: { weekStart: page.weekStart, dayIndex, startIndex, span },
        weekStart: page.weekStart,
        dayIndex,
        startIndex,
        span,
        valid: true,
      });
    },
    [pageUnderFinger, setInteraction],
  );

  /** One boundary crossed: tick once, and re-check the proposed range. */
  const handleDetent = useCallback(
    (dayIndex: number, startIndex: number, span: number) => {
      selectionTick();
      const current = latestInteraction.get();
      if (current.kind === "creatingRange") {
        setInteraction({ ...current, dayIndex, startIndex, span, valid: rangeIsFree(null, dayIndex, startIndex, span) });
        return;
      }
      if (current.kind === "resizingStart" || current.kind === "resizingEnd" || current.kind === "movingEvent") {
        setInteraction({ ...current, dayIndex, startIndex, span, valid: rangeIsFree(current.occurrenceId, dayIndex, startIndex, span) });
      }
    },
    [latestInteraction, rangeIsFree, setInteraction],
  );

  /**
   * Anything --cancel--> back where it started, with nothing committed.
   *
   * A gesture that was taken away rather than released — a second finger, a
   * lost pointer, the app going to the background — is not a decision, so
   * the class returns to its origin and the store never hears about it. A
   * move that never moved lands here too, visually identical to the release
   * that selects it, because both end with the block exactly where it was.
   */
  const cancelManipulation = useCallback(() => {
    const current = latestInteraction.get();
    setSubject(null);

    if (current.kind === "creatingRange") {
      setInteraction(IDLE);
      return;
    }
    if (current.kind !== "resizingStart" && current.kind !== "resizingEnd" && current.kind !== "movingEvent") return;

    const { origin, occurrenceId } = current;
    setInteraction(
      occurrenceId ? { kind: "eventSelected", occurrenceId, ...origin } : { kind: "provisionalSelected", ...origin },
    );
  }, [latestInteraction, setInteraction]);

  /**
   * creatingRange --release--> provisionalSelected (dropped if it overlaps)
   * resizing* | movingEvent --release--> eventSelected, committed only when
   * the proposed range is free.
   *
   * The store write lives here, in the callback the gesture hands the drag
   * to, and never inside a `setState` updater: an updater runs during the
   * render that flushes it, so moving the class from there would update the
   * app-state provider while this component is rendering. `settleShaping`
   * guarantees the hand-over happens once, so the write happens once.
   *
   * A gesture that was interrupted, changed nothing, or came to rest
   * somewhere it cannot land returns to where it started and hands nothing
   * over at all — so none of those can raise the scope question.
   */
  const finishManipulation = useCallback(
    (dayIndex: number, startIndex: number, span: number) => {
      const current = latestInteraction.get();
      setSubject(null);

      if (current.kind === "creatingRange") {
        setInteraction(
          rangeIsFree(null, dayIndex, startIndex, span)
            ? { kind: "provisionalSelected", weekStart: current.weekStart, dayIndex, startIndex, span }
            : IDLE,
        );
        return;
      }

      // The gesture was cut short before it ever became a manipulation, or
      // something else has already settled it: there is nothing to commit.
      if (current.kind !== "resizingStart" && current.kind !== "resizingEnd" && current.kind !== "movingEvent") return;

      const { origin, occurrenceId } = current;
      const unchanged = dayIndex === origin.dayIndex && startIndex === origin.startIndex && span === origin.span;
      const page = pageUnderFinger();
      const occurrence = occurrenceId ? page.blocks.find((block) => block.occurrenceId === occurrenceId) : undefined;
      if (!occurrenceId || !occurrence || unchanged || !rangeIsFree(occurrenceId, dayIndex, startIndex, span)) {
        setInteraction(
          occurrenceId ? { kind: "eventSelected", occurrenceId, ...origin } : { kind: "provisionalSelected", ...origin },
        );
        return;
      }

      const weekday = weekdays[dayIndex];
      setInteraction({ kind: "eventSelected", occurrenceId, weekStart: origin.weekStart, dayIndex, startIndex, span });
      const outcome = onMoveClass({
        occurrence,
        weekday,
        timeSlotId: timeSlots[startIndex].id,
        slotSpan: span,
        date: page.dates[weekday],
        source: current.kind === "movingEvent" ? "move" : "resize",
      });
      deferredOrigin.set(outcome === "deferred" ? { occurrenceId, origin } : null);
    },
    [
      deferredOrigin,
      latestInteraction,
      onMoveClass,
      rangeIsFree,
      setInteraction,
      timeSlots,
      pageUnderFinger,
      weekdays,
    ],
  );

  /** Period under a surface-relative y, fractional part included. */
  const slotFloatAtY = (y: number): number => {
    "worklet";
    const height = slotHeight.get();
    if (height <= 0) return -1;
    return (y - DAY_HEADER_HEIGHT + scrollY.get()) / height;
  };

  /**
   * Day column under a surface-relative x, fractional part included, in the
   * week's own coordinates — so it already accounts for how far the week
   * has been shifted sideways inside its page.
   */
  const dayFloatAtX = (x: number): number => {
    "worklet";
    const width = columnWidth.get();
    if (width <= 0) return -1;
    return (x - TIME_GUTTER_WIDTH + offsetX.get()) / width;
  };

  /**
   * Day column under a surface-relative x, or -1 in the gutter or past the
   * week. The gutter is excluded by its own test rather than by the
   * arithmetic going negative: once the week is scrolled sideways, a point
   * over the gutter still lands on a real column.
   */
  const dayAtX = (x: number): number => {
    "worklet";
    if (columnWidth.get() <= 0 || x < TIME_GUTTER_WIDTH) return -1;
    const index = Math.floor(dayFloatAtX(x));
    return index >= 0 && index < dayCount ? index : -1;
  };

  /**
   * What is under a point on the surface. A handle wins over whatever is
   * beneath it: handles only exist while a class is selected, and they are
   * what the user was aiming at.
   *
   * Both the pan and the hold hit-test through this, each from its own
   * event, so neither depends on the other having run first.
   */
  const targetAt = (x: number, y: number): number => {
    "worklet";
    const height = slotHeight.get();
    const dayIndex = dayAtX(x);
    const slotFloat = slotFloatAtY(y);
    if (height <= 0 || y < DAY_HEADER_HEIGHT || dayIndex < 0 || slotFloat < 0 || slotFloat >= slotCount) return TARGET_CHROME;

    const selection = selectionSV.get();
    if (selection && selection.occurrenceId !== null && selection.dayIndex === dayIndex) {
      const fingerY = slotFloat * height;
      if (Math.abs(fingerY - selection.startIndex * height) <= HANDLE_TOUCH_RADIUS) return TARGET_HANDLE_START;
      if (Math.abs(fingerY - (selection.startIndex + selection.span) * height) <= HANDLE_TOUCH_RADIUS) return TARGET_HANDLE_END;
    }

    for (let index = 0; index < hitBlocks.get().length; index++) {
      const candidate = hitBlocks.get()[index];
      if (candidate.dayIndex === dayIndex && slotFloat >= candidate.startIndex && slotFloat < candidate.startIndex + candidate.span) {
        return TARGET_BLOCK;
      }
    }
    return TARGET_EMPTY;
  };

  /**
   * Lets a horizontal drag inside the week coast to a stop, clamped to the
   * week's own ends. Nothing here can reach the pager, so a fling that runs
   * into an edge simply stops there rather than carrying on into next week.
   */
  const flingWeek = (velocityX: number) => {
    "worklet";
    const maxOffset = maxOffsetXFor(columnWidth.get(), dayCount, bodyWidth);
    if (maxOffset <= 0) return;
    offsetSettling.set(1);
    offsetX.set(
      withDecay({ velocity: -velocityX, deceleration: SCROLL_DECELERATION, clamp: [0, maxOffset] }, () => {
        offsetSettling.set(0);
      }),
    );
  };

  /**
   * Where a dragged edge should sit, as a period boundary.
   *
   * The edge is carried by the finger — `dragGrabEdge` holds how far from
   * the boundary the handle was actually grabbed — and moves on once that
   * finger is `RESIZE_SNAP_FRACTION` of the way through the neighbouring
   * period, in whichever direction it is travelling.
   *
   * Halfway is too early: the block changes size while the finger is still
   * visibly short of the period it is claiming. All the way is too late:
   * the edge has to be dragged flush against the next boundary before
   * anything happens, which reads as the handle being stuck. Three quarters
   * is close enough to the boundary to feel like reaching it.
   *
   * Measuring from where the edge *currently* is, rather than from where
   * the drag began, is what keeps it from chattering: after a step the
   * finger is a quarter of a period past the new edge, so it must travel
   * half a period back before the edge returns. There is no position at
   * which a tremor can flip it.
   */
  const snapEdge = (slotFloat: number, currentEdge: number): number => {
    "worklet";
    const travelled = slotFloat - dragGrabEdge.get() - currentEdge;
    if (travelled >= RESIZE_SNAP_FRACTION) {
      return currentEdge + Math.floor(travelled - RESIZE_SNAP_FRACTION) + 1;
    }
    if (travelled <= -RESIZE_SNAP_FRACTION) {
      return currentEdge - Math.floor(-travelled - RESIZE_SNAP_FRACTION) - 1;
    }
    return currentEdge;
  };

  /**
   * Moves the range being shaped to where the finger is. Runs on the UI
   * thread for every touch sample; JavaScript only hears about it when the
   * snapped range actually changes.
   */
  const applyShaping = (x: number, y: number) => {
    "worklet";
    const height = slotHeight.get();
    if (height <= 0 || columnWidth.get() <= 0) return;

    const mode = panMode.get();
    const slotFloat = (y - DAY_HEADER_HEIGHT + scrollY.get()) / height;
    const period = clampValue(Math.floor(slotFloat), 0, slotCount - 1);

    let nextDay = dragDay.get();
    let nextStart = dragStart.get();
    let nextSpan = dragSpan.get();

    if (mode === PAN_CREATE) {
      // The period the finger went down on is the anchor; crossing it simply
      // swaps which end of the range is the one that moves.
      const anchor = dragAnchor.get();
      nextStart = Math.min(anchor, period);
      nextSpan = Math.abs(period - anchor) + 1;
      labelBelow.set(period >= anchor ? 0 : 1);
    } else if (mode === PAN_RESIZE_START) {
      // The bottom edge is frozen, so the range can never invert or vanish.
      const bottom = dragFixedEdge.get();
      nextStart = clampValue(snapEdge(slotFloat, dragStart.get()), 0, bottom - 1);
      nextSpan = bottom - nextStart;
    } else if (mode === PAN_RESIZE_END) {
      const top = dragFixedEdge.get();
      nextStart = top;
      // Both edges are boundary indices, so the span is simply the distance
      // between them — never a period count that has to be adjusted by one.
      nextSpan = clampValue(snapEdge(slotFloat, top + dragSpan.get()), top + 1, slotCount) - top;
    } else if (mode === PAN_MOVE) {
      // Both axes are measured from the point inside the block the finger
      // actually grabbed, so the block sits still at the moment the hold
      // activates and then travels with the finger rather than snapping to
      // whichever cell the fingertip happens to be over.
      nextDay = clampValue(Math.round(dayFloatAtX(x) - dragGrabDay.get()), 0, dayCount - 1);
      // Duration is preserved: only where the block starts can change.
      nextStart = clampValue(Math.round(slotFloat - dragGrabOffset.get()), 0, slotCount - dragSpan.get());
    } else {
      return;
    }

    if (nextDay === dragDay.get() && nextStart === dragStart.get() && nextSpan === dragSpan.get()) return;
    dragDay.set(nextDay);
    dragStart.set(nextStart);
    dragSpan.set(nextSpan);
    runOnJS(handleDetent)(nextDay, nextStart, nextSpan);
  };

  /**
   * Closes out the shaped range exactly once, however the gesture ended.
   *
   * A release commits it; anything else gives it back. The distinction is
   * drawn here rather than from the pan's own success flag, because a pan
   * that shapes a range never activates — it is driven from the touch
   * callbacks — so it always finalizes as a failure however it ended. The
   * finger lifting is what `onTouchesUp` reports, and that is the only
   * thing that counts as a decision.
   */
  const settleShaping = (cancelled: boolean) => {
    "worklet";
    if (dragSettled.get() === 1) return;
    dragSettled.set(1);
    if (cancelled) {
      runOnJS(cancelManipulation)();
      return;
    }
    runOnJS(finishManipulation)(dragDay.get(), dragStart.get(), dragSpan.get());
  };

  /**
   * One pan for every one-finger drag. What it becomes is decided once —
   * from where the finger went down, whether a hold had already claimed it,
   * and which way it first moved — and then held for the rest of the
   * gesture, so a release can only ever perform the one action it started.
   *
   * Only scrolling and paging activate it: those are the two that need the
   * release velocity. Shaping a range is driven from the touch callbacks
   * instead, which keeps it out of the activation race entirely.
   */
  const pan = Gesture.Pan()
    .maxPointers(1)
    .manualActivation(true)
    .onTouchesDown((event) => {
      "worklet";
      const touch = event.allTouches[0];
      touchStartX.set(touch.x);
      touchStartY.set(touch.y);
      panMode.set(PAN_NONE);
      dragSettled.set(0);

      // A second finger has joined: whatever this sequence is, it is not a
      // one-finger drag, and it must not become one when that finger goes
      // again. `pointerTracker` lifts this once the hand is off the glass.
      if (event.numberOfTouches > 1) pinchLock.set(1);

      // Work out what is under the finger now, while the geometry is still
      // static, so the slop-crossing decision is a lookup rather than a
      // second hit-test against a surface that may have started moving.
      touchTarget.set(targetAt(touch.x, touch.y));

      // Catching a flinging grid stops it where it is, whichever way it was
      // flung, and that touch does not also count as a tap. A page settling
      // towards its week is left to finish; a drag from here simply takes
      // over from its position.
      const flinging = scrollSettling.get() === 1 || offsetSettling.get() === 1;
      if (flinging) {
        cancelAnimation(scrollY);
        cancelAnimation(offsetX);
        scrollSettling.set(0);
        offsetSettling.set(0);
        suppressTap.set(1);
        return;
      }
      suppressTap.set(pageSettling.get());
    })
    .onTouchesMove((event, manager) => {
      "worklet";
      // Anything multi-touch, during a pinch or after it, is not this
      // gesture's to act on until every finger has gone.
      if (axis.get() === AXIS.pinch || pinchLock.get() === 1 || event.numberOfTouches > 1) {
        manager.fail();
        return;
      }

      const touch = event.allTouches[0];
      const mode = panMode.get();

      // A hold already owns this gesture: the finger shapes a range and can
      // no longer scroll, page or zoom with it.
      if (mode >= PAN_CREATE) {
        applyShaping(touch.x, touch.y);
        return;
      }
      // Axis locking: once page, scroll or a bare selection has been chosen,
      // this gesture is that and nothing else until the finger lifts.
      if (mode !== PAN_NONE) return;

      const dx = touch.x - touchStartX.get();
      const dy = touch.y - touchStartY.get();
      if (Math.abs(dx) < TOUCH_SLOP && Math.abs(dy) < TOUCH_SLOP) return;

      // A handle grabbed at finger-down outranks both axes: pulling an edge
      // sideways is still a resize, and it must not scroll the grid away.
      const target = touchTarget.get();
      const selection = selectionSV.get();
      if ((target === TARGET_HANDLE_START || target === TARGET_HANDLE_END) && selection && selection.occurrenceId !== null) {
        axis.set(AXIS.block);
        panMode.set(target === TARGET_HANDLE_START ? PAN_RESIZE_START : PAN_RESIZE_END);
        dragDay.set(selection.dayIndex);
        dragStart.set(selection.startIndex);
        dragSpan.set(selection.span);
        // The edge that is not being dragged stays exactly where it is.
        dragFixedEdge.set(target === TARGET_HANDLE_START ? selection.startIndex + selection.span : selection.startIndex);
        // Measured from where the finger went down, not from here: the slop
        // it had to cross to become a resize is part of the drag, so the
        // handle is carried from the point it was actually grabbed at — a
        // touch target that reaches well past the edge it belongs to.
        dragGrabEdge.set(
          slotFloatAtY(touchStartY.get()) -
            (target === TARGET_HANDLE_START ? selection.startIndex : selection.startIndex + selection.span),
        );
        labelBelow.set(target === TARGET_HANDLE_START ? 0 : 1);
        suppressTap.set(1);
        runOnJS(beginResize)(
          target === TARGET_HANDLE_START ? "start" : "end",
          selection.occurrenceId,
          selection.dayIndex,
          selection.startIndex,
          selection.span,
        );
        return;
      }

      // Nothing was claimed before the slop was crossed, so this is plain
      // movement of the surface — never the start of a new class.
      suppressTap.set(1);
      if (Math.abs(dx) > Math.abs(dy)) {
        // Which of the two horizontal gestures this is, decided here and
        // then fixed. A drag heading for an end of the week it is already
        // standing on has nothing left to scroll and so pages; anything
        // else scrolls the week and is not allowed to page later on, however
        // far it is dragged after it hits the end.
        const maxOffset = maxOffsetXFor(columnWidth.get(), dayCount, bodyWidth);
        const atEdge =
          dx > 0 ? offsetX.get() <= EDGE_EPSILON : offsetX.get() >= maxOffset - EDGE_EPSILON;
        axis.set(AXIS.horizontal);
        panMode.set(maxOffset <= 0 || atEdge ? PAN_PAGE : PAN_WEEK);
        panStartPos.set(pos.get());
        panStartOffsetX.set(offsetX.get());
      } else {
        axis.set(AXIS.vertical);
        panMode.set(PAN_SCROLL);
        panStartScroll.set(scrollY.get());
      }
      runOnJS(dismissProvisional)();
      manager.activate();
    })
    .onTouchesUp(() => {
      "worklet";
      // The finger lifted, so whatever was being shaped was meant.
      if (panMode.get() >= PAN_CREATE) settleShaping(false);
    })
    .onUpdate((event) => {
      "worklet";
      // A pinch has taken the sequence over. Even if this handler is still
      // being fed, it must write nothing: the pinch owns all three offsets
      // now, and two writers would fight over every frame.
      if (pinchLock.get() === 1) return;
      const mode = panMode.get();

      if (mode === PAN_WEEK) {
        // Hard clamp, no overflow anywhere: the week stops at its end and
        // the rest of the drag is simply absorbed. Nothing is handed to the
        // pager, so this gesture cannot change week however far it goes.
        const maxOffset = maxOffsetXFor(columnWidth.get(), dayCount, bodyWidth);
        offsetX.set(clampValue(panStartOffsetX.get() - event.translationX, 0, maxOffset));
        return;
      }

      if (mode === PAN_PAGE) {
        if (size.width <= 0) return;
        // Claimed against an end of the week, so most of this drag is a page
        // change. What is left of the week in the other direction is still
        // scrolled through first, which is what lets a drag that started at
        // the edge and reversed come back into the week instead of paging.
        const maxOffset = maxOffsetXFor(columnWidth.get(), dayCount, bodyWidth);
        const desired = panStartOffsetX.get() - event.translationX;
        const settled = clampValue(desired, 0, maxOffset);
        offsetX.set(settled);
        pos.set(panStartPos.get() + (desired - settled) / size.width);
        return;
      }

      if (mode === PAN_SCROLL) {
        const maxScroll = maxScrollFor(slotHeight.get(), slotCount, bodyHeight);
        scrollY.set(clampValue(panStartScroll.get() - event.translationY, 0, maxScroll));
      }
    })
    .onEnd((event, success) => {
      "worklet";
      const mode = panMode.get();

      if (!success) {
        // Cut short rather than released — a second finger, most likely.
        // Return to the page the drag began on instead of committing one,
        // and let the fling die where it is.
        if (mode === PAN_PAGE) {
          pageSettling.set(1);
          pos.set(
            withSpring(Math.round(panStartPos.get()), PAGE_SPRING, () => {
              pageSettling.set(0);
              runOnJS(reconcilePage)();
            }),
          );
        }
        return;
      }
      // A release that a pinch has already taken over is not a release of
      // this gesture: it must not commit a page, a fling or anything else.
      if (pinchLock.get() === 1) return;
      if (mode === PAN_WEEK) {
        flingWeek(event.velocityX);
        return;
      }
      if (mode === PAN_PAGE) {
        if (size.width <= 0) return;
        // Measured from the page the drag started on. Taking it from the
        // committed week instead would misjudge every drag that began while
        // an earlier settle was still running.
        const from = Math.round(panStartPos.get());
        const travelled = pos.get() - from;

        // Claimed at an edge but reversed back into the week without ever
        // reaching the pager: that was a look around inside the week, so it
        // settles as one. With no slack this cannot happen, which leaves an
        // ordinary swipe untouched.
        if (travelled === 0 && maxOffsetXFor(columnWidth.get(), dayCount, bodyWidth) > 0) {
          flingWeek(event.velocityX);
          return;
        }

        const velocityPages = -event.velocityX / size.width;
        const projected = travelled + velocityPages * PAGE_VELOCITY_PROJECTION_SECONDS;

        let direction = 0;
        if (Math.abs(velocityPages) >= PAGE_FLICK_VELOCITY) direction = velocityPages > 0 ? 1 : -1;
        else if (Math.abs(projected) >= PAGE_COMMIT_FRACTION) direction = projected > 0 ? 1 : -1;

        // The release velocity is handed straight to the spring, so the
        // settle is a continuation of the drag rather than a new animation.
        pageSettling.set(1);
        pos.set(
          withSpring(from + direction, { ...PAGE_SPRING, velocity: velocityPages }, () => {
            pageSettling.set(0);
            runOnJS(reconcilePage)();
          }),
        );
        // A week actually changing hands opens the new one at its first day.
        // A drag that settles back onto the week it started on keeps its
        // place inside it — nothing has been left behind.
        if (direction !== 0) returnToWeekStart();
        return;
      }
      if (mode === PAN_SCROLL) {
        scrollSettling.set(1);
        scrollY.set(
          withDecay(
            {
              velocity: -event.velocityY,
              deceleration: SCROLL_DECELERATION,
              clamp: [0, maxScrollFor(slotHeight.get(), slotCount, bodyHeight)],
            },
            () => {
              scrollSettling.set(0);
            },
          ),
        );
      }
    })
    .onFinalize(() => {
      "worklet";
      // Reached without a release: a second finger, a lost pointer, the app
      // going away. Whatever was being shaped goes back where it started —
      // `settleShaping` only runs once, so a real release has already
      // committed by now and this does nothing.
      if (panMode.get() >= PAN_CREATE) settleShaping(true);
      if (axis.get() !== AXIS.pinch) axis.set(AXIS.none);
      panMode.set(PAN_NONE);
      touchTarget.set(TARGET_CHROME);
    });

  /**
   * Both scales at once: periods grow taller and day columns grow wider
   * from the same factor, so a pinch opens the grid the way pinching a map
   * opens a map rather than only stretching the hours.
   *
   * It runs entirely in these worklets — the factor, both scales, both
   * offsets and both anchors are shared values — so a pinch never
   * re-renders the week, never changes which week is current, and never
   * re-keys anything. The blocks' widths and heights are real layout props
   * driven from those same values, which is what gives their text more room
   * instead of magnifying it.
   */
  const pinch = Gesture.Pinch()
    // Nothing here may hang off `onBegin`: a pinch handler begins on the
    // first pointer of *any* touch, long before a second finger exists, so
    // anything raised there would be raised for every tap and every drag.
    .onStart((event) => {
      "worklet";
      // Zoom is not available while a range or a class is being shaped.
      if (axis.get() === AXIS.block || panMode.get() >= PAN_CREATE) return;
      pinchActive.set(1);
      pinchLock.set(1);
      suppressTap.set(1);
      axis.set(AXIS.pinch);
      // Both scroll flings stop dead: the pinch is about to solve for both
      // offsets itself, and a decay still writing to them would fight it.
      cancelAnimation(scrollY);
      cancelAnimation(offsetX);
      offsetSettling.set(0);
      scrollSettling.set(0);

      // The pager is deliberately *not* frozen. A page settle that is still
      // running was already asked for by the swipe that preceded this pinch,
      // and it writes only to `pos`, which nothing below touches. Freezing
      // it here used to strand the pager between two weeks for as long as
      // the pinch lasted, and the spring that then had to put it right ran
      // at the moment the fingers came up — which is the jump that made a
      // finished pinch look like the start of another gesture. Left alone,
      // the week simply finishes arriving while the grid zooms.

      pinchStartZoom.set(zoom.get());
      pinchStartScale.set(event.scale);
      // Activation should always carry two fingers. If it somehow does not,
      // the anchor taken below is a single finger's position rather than a
      // midpoint, so the first genuine pair re-takes it.
      pinchRegrab.set(event.numberOfPointers < 2 ? 1 : 0);

      // Nothing has moved yet, so the frozen state is simply the state.
      frozenScaleX.set(pinchScaleX.get());
      frozenScaleY.set(pinchScaleY.get());
      frozenScrollY.set(scrollY.get());
      frozenOffsetX.set(offsetX.get());
      frozenZoom.set(zoom.get());

      // The grid point the fingers started around, in periods and columns.
      // Holding *this* still is what anchoring means: it is expressed in
      // content coordinates, so it stays the same point whatever the scale
      // becomes, and both offsets are then solved for rather than nudged.
      //
      // Measured against settled × transient rather than settled alone.
      // The transient scales are 1 whenever a pinch begins from rest, so
      // this is the same number — but it stays the *live* geometry however
      // the surface got here, and the anchor has to be read in live pixels
      // or the grid lurches on the first frame.
      const height = slotHeight.get() * pinchScaleY.get();
      const width = columnWidth.get() * pinchScaleX.get();
      pinchAnchorSlot.set(height > 0 ? (scrollY.get() + event.focalY - DAY_HEADER_HEIGHT) / height : 0);
      pinchAnchorColumn.set(width > 0 ? (offsetX.get() + event.focalX - TIME_GUTTER_WIDTH) / width : 0);
      runOnJS(dismissProvisional)();
    })
    .onUpdate((event) => {
      "worklet";
      if (pinchActive.get() !== 1) return;

      /**
       * A pinch is only a pinch while two fingers are measuring it.
       *
       * The native handler does not end when the first finger leaves — it
       * ends on the last one — and in between it keeps reporting. What it
       * reports is `ScaleGestureDetector`'s focus, which on a pointer-up
       * collapses from the midpoint of two fingers onto the one that
       * remains. The focal point therefore leaps by half the span the
       * fingers had, and because both offsets here are *solved* from the
       * focal point to hold the anchor still, the grid leaps with it — the
       * full width of that gap, in the frame the finger comes off. That is
       * the jump, and it has nothing to do with layout or with the
       * hand-over: it is a real reported change in a gesture that is no
       * longer the gesture the user is making.
       *
       * So the grid stops listening the moment the pair is broken, and
       * holds whatever the pair last agreed on.
       */
      if (event.numberOfPointers < 2) {
        pinchRegrab.set(1);
        return;
      }

      // A pair regained after one was lifted is a new grip on the same
      // gesture: re-anchor to where these two fingers are now, or the grid
      // would snap to satisfy an anchor taken from a hold that is over.
      if (pinchRegrab.get() === 1) {
        pinchRegrab.set(0);
        pinchStartZoom.set(zoom.get());
        pinchStartScale.set(event.scale);
        const heldHeight = slotHeight.get() * pinchScaleY.get();
        const heldWidth = columnWidth.get() * pinchScaleX.get();
        pinchAnchorSlot.set(heldHeight > 0 ? (scrollY.get() + event.focalY - DAY_HEADER_HEIGHT) / heldHeight : 0);
        pinchAnchorColumn.set(heldWidth > 0 ? (offsetX.get() + event.focalX - TIME_GUTTER_WIDTH) / heldWidth : 0);
      }

      // Measured as a ratio against the scale this grip started at, so a
      // re-grip continues from where the last one stopped instead of
      // restarting from whatever the detector happens to be counting from.
      const grip = pinchStartScale.get();
      const nextZoom = clampValue(pinchStartZoom.get() * (grip > 0 ? event.scale / grip : event.scale), 1, maxZoom);
      const liveHeight = slotHeightForZoom(nextZoom, bodyHeight, slotCount);
      const liveWidth = columnWidthForZoom(nextZoom, bodyWidth, dayCount);
      zoom.set(nextZoom);

      // Five shared-value writes and nothing else — no `runOnJS`, no
      // measurement, no allocation. The settled scales are deliberately
      // left alone: touching them here is what used to put a layout pass
      // over every block, rule and label into every frame of the gesture.
      const settledHeight = slotHeight.get();
      const settledWidth = columnWidth.get();
      pinchScaleY.set(settledHeight > 0 ? liveHeight / settledHeight : 1);
      pinchScaleX.set(settledWidth > 0 ? liveWidth / settledWidth : 1);

      // Solved against the *live* focal point and the live scales, so the
      // anchor also follows two fingers that drift while they spread — the
      // grid tracks the fingers instead of pulling towards the top-left.
      scrollY.set(clampValue(
        pinchAnchorSlot.get() * liveHeight - (event.focalY - DAY_HEADER_HEIGHT),
        0,
        maxScrollFor(liveHeight, slotCount, bodyHeight),
      ));
      offsetX.set(clampValue(
        pinchAnchorColumn.get() * liveWidth - (event.focalX - TIME_GUTTER_WIDTH),
        0,
        maxOffsetXFor(liveWidth, dayCount, bodyWidth),
      ));

      // Everything two fingers agreed on, kept so the release can be made
      // from it rather than from whatever is reported afterwards.
      frozenScaleX.set(pinchScaleX.get());
      frozenScaleY.set(pinchScaleY.get());
      frozenScrollY.set(scrollY.get());
      frozenOffsetX.set(offsetX.get());
      frozenZoom.set(nextZoom);
    })
    .onFinalize(() => {
      "worklet";
      const wasPinching = pinchActive.get() === 1;
      pinchActive.set(0);
      if (!wasPinching) return;
      axis.set(AXIS.none);

      // Phase A. The grid goes back to the last frame two fingers agreed
      // on. Normally every one of these is already what it holds — the
      // update guard saw to that — so this writes nothing new; it is here
      // so that a report slipping through on some other platform costs a
      // single frame rather than a lasting displacement.
      const scaleX = frozenScaleX.get();
      const scaleY = frozenScaleY.get();
      pinchScaleX.set(scaleX);
      pinchScaleY.set(scaleY);
      scrollY.set(frozenScrollY.get());
      offsetX.set(frozenOffsetX.get());
      zoom.set(frozenZoom.get());

      /**
       * Phase B. The two halves of the zoom trade places.
       *
       * The new settled scales are read off the screen — `settled × scale`,
       * the product the grid is *already* drawing — rather than recomputed
       * from the zoom factor. That makes the swap an identity: whatever the
       * two halves multiplied to a moment ago, one of them now holds alone.
       * There is no arithmetic path by which this can land on a different
       * number than the frame before it, which is a stronger guarantee than
       * two derivations agreeing.
       *
       * The offsets need no conversion. They have been kept in live pixels
       * throughout, and a block sits at `column × width - offsetX` either
       * way round: width settled with the scale at 1, or width stale with
       * the scale making up the difference. Both evaluate to the same
       * pixel, so neither offset is touched here.
       *
       * A pinch too small to have changed either scale commits nothing at
       * all, and so cannot cost a layout pass for no reason.
       */
      const settledHeight = slotHeight.get();
      const settledWidth = columnWidth.get();
      const liveHeight = settledHeight * scaleY;
      const liveWidth = settledWidth * scaleX;
      const changed = Math.abs(scaleX - 1) > SCALE_EPSILON || Math.abs(scaleY - 1) > SCALE_EPSILON;

      if (changed) {
        slotHeight.set(liveHeight);
        columnWidth.set(liveWidth);

        // Text is the one thing a worklet cannot re-flow, so it follows a
        // render later. It changes what fits inside a block, never where
        // the block is, so arriving late cannot move anything.
        runOnJS(commitSettledZoom)(liveHeight);
      }
      // Always, so a pinch that ended where it began cannot leave a residue
      // for the next one to build on.
      pinchScaleY.set(1);
      pinchScaleX.set(1);

      if (instrumentHandoff) {
        // Where the anchor the fingers were holding sits on screen, worked
        // out both ways round. These must print the same pixel.
        runOnJS(reportZoomHandoff)({
          anchorSlot: pinchAnchorSlot.get(),
          anchorColumn: pinchAnchorColumn.get(),
          beforeX: TIME_GUTTER_WIDTH + pinchAnchorColumn.get() * settledWidth * scaleX - offsetX.get(),
          beforeY: DAY_HEADER_HEIGHT + pinchAnchorSlot.get() * settledHeight * scaleY - scrollY.get(),
          afterX: TIME_GUTTER_WIDTH + pinchAnchorColumn.get() * liveWidth - offsetX.get(),
          afterY: DAY_HEADER_HEIGHT + pinchAnchorSlot.get() * liveHeight - scrollY.get(),
          scrollY: scrollY.get(),
          offsetX: offsetX.get(),
          settledHeightBefore: settledHeight,
          settledWidthBefore: settledWidth,
          settledHeightAfter: liveHeight,
          settledWidthAfter: liveWidth,
          scaleX,
          scaleY,
        });
      }

      // The pager is left strictly alone. It is either already whole — in
      // which case this only agrees on which week that is — or a settle
      // that began before the pinch is still flying it home and owns its
      // own arrival. Nothing here may animate it, or a finished pinch would
      // end by moving the grid the user had just placed.
      if (pageSettling.get() === 0) runOnJS(reconcilePage)();
    });

  /**
   * The hold, and the only thing that can start a manipulation.
   *
   * It is a real long press running *alongside* the pan rather than a pan
   * that activates late: a competing pan would have to win the activation
   * race before the pan that scrolls could ever be allowed to activate, and
   * on release it would already have claimed the gesture. Here, arbitration
   * is a shared value instead — the hold only takes the gesture if the pan
   * has not already made it a scroll, a page or a resize.
   *
   * On empty grid it opens a range to drag out. On a class it picks the
   * class up: the haptic fires, and from that instant the same finger,
   * without lifting, is dragging the block. Nothing further is asked for —
   * the hold and the drag are one gesture, and letting go without having
   * moved is what leaves the class selected with its handles out.
   */
  const hold = Gesture.LongPress()
    .minDuration(BLOCK_LONG_PRESS_MS)
    // Beyond this the finger is moving, not holding, and the pan owns it.
    .maxDistance(TOUCH_SLOP)
    .onStart((event) => {
      "worklet";
      // `pinchLock` outlives the pinch itself: a finger resting on the grid
      // after a zoom is the end of that gesture, not the start of a hold.
      if (axis.get() !== AXIS.none || panMode.get() !== PAN_NONE || pinchActive.get() === 1 || pinchLock.get() === 1) {
        return;
      }

      const target = targetAt(event.x, event.y);
      // A handle is aimed at, not held: holding one must stay a resize.
      if (target !== TARGET_EMPTY && target !== TARGET_BLOCK) return;

      const dayIndex = dayAtX(event.x);
      const dayFloat = dayFloatAtX(event.x);
      const slotFloat = slotFloatAtY(event.y);
      const slotIndex = Math.floor(slotFloat);
      if (dayIndex < 0 || slotIndex < 0 || slotIndex >= slotCount) return;

      if (target === TARGET_EMPTY) {
        // From here the gesture belongs to the hold; the release is its own.
        axis.set(AXIS.block);
        suppressTap.set(1);
        dragSettled.set(0);
        labelBelow.set(0);
        panMode.set(PAN_CREATE);
        dragAnchor.set(slotIndex);
        dragDay.set(dayIndex);
        dragStart.set(slotIndex);
        dragSpan.set(1);
        interactionSV.set(INTERACTION.creatingRange);
        runOnJS(beginCreateRange)(dayIndex, slotIndex);
        return;
      }

      let hit: HitBlock | null = null;
      for (let index = 0; index < hitBlocks.get().length; index++) {
        const candidate = hitBlocks.get()[index];
        if (
          candidate.dayIndex === dayIndex &&
          slotFloat >= candidate.startIndex &&
          slotFloat < candidate.startIndex + candidate.span
        ) {
          hit = candidate;
          break;
        }
      }
      // The visible week can have changed under a stale hit-test; without a
      // class to hold there is nothing to pick up, and the tap still stands.
      if (!hit || hit.occurrenceId === null) return;

      axis.set(AXIS.block);
      suppressTap.set(1);
      dragSettled.set(0);
      labelBelow.set(0);

      dragDay.set(hit.dayIndex);
      dragStart.set(hit.startIndex);
      dragSpan.set(hit.span);
      // Where in the block the finger actually is, along both axes. Every
      // later sample is measured against these, so the block is exactly
      // where it was when the haptic fired and does not jump under the
      // finger the moment the drag begins.
      dragGrabOffset.set(slotFloat - hit.startIndex);
      dragGrabDay.set(dayFloat - hit.dayIndex);
      // The gesture is a move from here: `onTouchesMove` sees a mode at or
      // above PAN_CREATE and shapes the drag instead of scrolling or
      // paging, and the pan can no longer activate for either.
      panMode.set(PAN_MOVE);
      interactionSV.set(INTERACTION.movingEvent);
      runOnJS(beginMove)(hit.occurrenceId, hit.dayIndex, hit.startIndex, hit.span);
    });

  const tap = Gesture.Tap()
    .maxDuration(TAP_MAX_DURATION_MS)
    .maxDistance(TOUCH_SLOP)
    .onEnd((event, success) => {
      "worklet";
      // Anything that claimed the gesture — a hold, a scroll, a page, a
      // pinch, a resize — owns its own release and suppresses the tap.
      if (!success || suppressTap.get() === 1 || axis.get() !== AXIS.none) return;
      runOnJS(handleTap)(event.x, event.y);
    });

  /**
   * Counts fingers, and nothing else.
   *
   * A manual gesture never activates, so it claims nothing and competes
   * with nothing — but it also never fails, which means it is the one
   * handler that keeps receiving touches for the whole sequence. The pan
   * stops hearing about them the moment a second finger makes it fail, and
   * the pinch stops the moment a finger leaves, so neither of them can say
   * when the hand has actually gone. This can.
   *
   * That matters because a pinch has to own its touches until the *last* of
   * them is lifted. Releasing on the pinch ending instead would hand the
   * finger still on the glass to the pan, which would read it as the start
   * of a page or a scroll and jerk the grid the user had just finished
   * placing.
   *
   * A finger arriving states the total outright, so that is taken as read;
   * a finger leaving is counted off instead, which avoids having to know
   * whether a platform still counts a lifting pointer as down. Since every
   * arrival re-states the total, a miscount cannot outlive the sequence it
   * happened in and strand the lock on.
   */
  const pointerTracker = Gesture.Manual()
    .onTouchesDown((event) => {
      "worklet";
      // Taken from the reported total rather than added to a running one:
      // a down is the one event whose count is unambiguous, so every new
      // finger re-synchronises this and no miscount can outlive a sequence
      // and leave the lock stuck on.
      pointersDown.set(event.numberOfTouches);
    })
    .onTouchesUp((event) => {
      "worklet";
      pointersDown.set(Math.max(0, pointersDown.get() - event.changedTouches.length));
      if (pointersDown.get() === 0) pinchLock.set(0);
    })
    .onTouchesCancelled((event) => {
      "worklet";
      pointersDown.set(Math.max(0, pointersDown.get() - event.changedTouches.length));
      if (pointersDown.get() === 0) pinchLock.set(0);
    })
    .onFinalize(() => {
      "worklet";
      // The sequence is over however it ended, so the count cannot drift.
      pointersDown.set(0);
      pinchLock.set(0);
    });

  /**
   * Nothing races here. Each gesture decides for itself whether it is
   * allowed to act, from shared values the others have already written, so
   * the priority — pinch, then resize or move, then the hold, then scroll
   * and page, then tap — is explicit rather than left to whichever native
   * recognizer happens to reach its threshold first. The tracker claims
   * nothing at all; it is in the composition only so that it is handed the
   * touches.
   */
  const gesture = Gesture.Simultaneous(pointerTracker, pinch, hold, pan, tap);

  const anchorDates = useMemo(() => weekDatesFrom(anchorWeekStart), [anchorWeekStart]);
  const todayColumnVisible = weekdays.some((day) => anchorDates[day] === today);

  // While a finger is shaping something, the live overlay draws it; the
  // page only draws the settled provisional or selected item.
  const live = isManipulating(interaction.kind);
  const pageOverlay: PageOverlay | null =
    !live && (interaction.kind === "provisionalSelected" || interaction.kind === "eventSelected")
      ? {
          kind: interaction.kind === "provisionalSelected" ? "provisional" : "selected",
          dayIndex: interaction.dayIndex,
          startIndex: interaction.startIndex,
          span: interaction.span,
        }
      : null;
  const overlayWeekStart = interaction.kind === "idle" ? null : interaction.weekStart;
  const hiddenOccurrenceId = live ? (subject?.occurrenceId ?? null) : null;

  return (
    <View
      style={styles.flex}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setSize((previous) => (previous.width === width && previous.height === height ? previous : { width, height }));
      }}
    >
      {size.width === 0 || slotCount === 0 ? null : (
        <GestureDetector gesture={gesture}>
          <View style={styles.flex} collapsable={false}>
            {/* Previous, current and next stay mounted throughout a drag and
                its settle. Each one places itself from its own page index,
                so the set can change at commit without moving the pages
                that survive — there is no shared wrapper to re-offset. */}
            {PAGE_OFFSETS.map((offset) => {
              const pageIndex = baseIndex + offset;
              const weekStart = addWeeksIso(anchorWeekStart, pageIndex);
              return (
                <WeekPage
                  key={weekStart}
                  weekStart={weekStart}
                  pageIndex={pageIndex}
                  pos={pos}
                  weekdays={weekdays}
                  timeSlots={timeSlots}
                  placements={placements}
                  courses={courses}
                  exceptions={exceptions}
                  preview={preview}
                  today={today}
                  now={now}
                  width={size.width}
                  columnWidth={columnWidth}
                  offsetX={offsetX}
                  slotHeight={slotHeight}
                  settledSlotHeight={settledSlotHeight}
                  pinchScaleX={pinchScaleX}
                  pinchScaleY={pinchScaleY}
                  scrollY={scrollY}
                  hiddenOccurrenceId={hiddenOccurrenceId}
                  overlay={weekStart === overlayWeekStart ? pageOverlay : null}
                />
              );
            })}

            <TimeGutter
              timeSlots={timeSlots}
              now={now}
              showNowLabel={todayColumnVisible}
              pageDistanceFromToday={pos}
              slotHeight={slotHeight}
              pinchScaleY={pinchScaleY}
              scrollY={scrollY}
            />

            <ManipulationOverlay
              interaction={interaction}
              subject={subject}
              timeSlots={timeSlots}
              columnWidth={columnWidth}
              offsetX={offsetX}
              slotHeight={slotHeight}
              scrollY={scrollY}
              dayIndex={dragDay}
              startIndex={dragStart}
              span={dragSpan}
              labelBelow={labelBelow}
            />
          </View>
        </GestureDetector>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    overflow: "hidden",
  },
});
