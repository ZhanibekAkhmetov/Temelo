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
  DAY_HEADER_HEIGHT,
  MAX_SLOT_HEIGHT,
  maxScrollFor,
  minSlotHeightFor,
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
const PAN_PAGE = 1;
const PAN_SCROLL = 2;
/** A hold that only selected a class: the rest of that gesture does nothing. */
const PAN_HELD = 3;
const PAN_CREATE = 4;
const PAN_RESIZE_START = 5;
const PAN_RESIZE_END = 6;
const PAN_MOVE = 7;

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
  /** Whether a proposed position is free, checked against recurrence overlap. */
  canPlaceClass: (input: PlacementPosition) => boolean;
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
  /** Destination date in the displayed week. */
  date: string;
}

/**
 * The whole timetable as one physical surface: weeks page horizontally,
 * time scrolls vertically, two fingers zoom the time scale, and blocks can
 * be placed, moved and resized — all arbitrated by a single gesture tree so
 * only one of those can ever be happening at a time.
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
  ref,
}: TimetableSurfaceProps) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [baseIndex, setBaseIndex] = useState(0);
  /** The single source of truth for what the user is doing. */
  const [interaction, setInteractionState] = useState<Interaction>(IDLE);
  const [subject, setSubject] = useState<ManipulationSubject | null>(null);

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
  const columnWidth = dayCount > 0 ? (size.width - TIME_GUTTER_WIDTH) / dayCount : 0;
  const visibleWeekStart = addWeeksIso(anchorWeekStart, baseIndex);

  // Continuous page position in weeks; `baseIndex` is the settled one.
  const pos = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const slotHeight = useSharedValue(0);
  const baseIdx = useSharedValue(0);
  const axis = useSharedValue<number>(AXIS.none);

  const touchStartX = useSharedValue(0);
  const touchStartY = useSharedValue(0);
  // A touch that lands on still-moving content stops it instead of acting.
  const scrollSettling = useSharedValue(0);
  const pageSettling = useSharedValue(0);
  const suppressTap = useSharedValue(0);
  // Raised only once a pinch has actually activated. It must never be tied
  // to the pinch beginning: a pinch handler begins on the first pointer of
  // any touch at all, so that would raise it for every tap and every drag.
  const pinchActive = useSharedValue(0);
  const panStartPos = useSharedValue(0);
  const panStartScroll = useSharedValue(0);
  const pinchStartSlotHeight = useSharedValue(0);
  const pinchAnchorSlot = useSharedValue(0);

  const hitBlocks = useSharedValue<HitBlock[]>([]);
  /** Geometry of the current provisional/selected item, for handle hit-tests. */
  const selectionSV = useSharedValue<HitBlock | null>(null);
  /** Mirror of `interaction.kind`, so the worklets can arbitrate on it. */
  const interactionSV = useSharedValue<number>(INTERACTION.idle);

  const touchTarget = useSharedValue(TARGET_CHROME);
  const panMode = useSharedValue(PAN_NONE);
  /** Raised once a shaping drag has been handed to JavaScript to commit. */
  const dragSettled = useSharedValue(0);

  const dragGrabOffset = useSharedValue(0);
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

  // Zoom starts fully out and is only re-clamped when the viewport or the
  // academic day changes — a finished pinch keeps whatever it produced.
  const hasPositioned = useRef(false);
  useEffect(() => {
    if (bodyHeight <= 0 || slotCount <= 0) return;
    const minHeight = minSlotHeightFor(bodyHeight, slotCount);

    if (!hasPositioned.current) {
      hasPositioned.current = true;
      slotHeight.set(minHeight);
      const focusIndex = findCurrentPeriodIndex(timeSlots, now);
      const maxScroll = maxScrollFor(minHeight, slotCount, bodyHeight);
      scrollY.set(clampValue(focusIndex * minHeight - bodyHeight / 3, 0, maxScroll));
      return;
    }

    slotHeight.set(clampValue(slotHeight.get(), minHeight, MAX_SLOT_HEIGHT));
    scrollY.set(clampValue(scrollY.get(), 0, maxScrollFor(slotHeight.get(), slotCount, bodyHeight)));
    // `now` only seeds the first position; later ticks must not scroll the grid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyHeight, slotCount, timeSlots]);

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
    },
    [pageSettling, pos, reconcilePage],
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
   * A whole series is checked against recurrence overlap through the store,
   * because it has to hold on every date it meets. A single occurrence that
   * has already stepped out of its series — and a range that is not a class
   * yet — only has to be free on the one date on screen, so it is checked
   * against what actually meets in the visible week.
   */
  const rangeIsFree = useCallback(
    (occurrenceId: string | null, dayIndex: number, startIndex: number, span: number): boolean => {
      if (dayIndex < 0 || dayIndex >= dayCount || startIndex < 0 || startIndex + span > slotCount) return false;

      const page = pageUnderFinger();
      const subject = occurrenceId ? page.blocks.find((block) => block.occurrenceId === occurrenceId) : undefined;
      if (subject && !subject.exception) {
        return canPlaceClass({
          placementId: subject.placement.id,
          weekday: weekdays[dayIndex],
          timeSlotId: timeSlots[startIndex].id,
          slotSpan: span,
          date: page.dates[weekdays[dayIndex]],
        });
      }
      return !page.blocks.some(
        (block) =>
          block.occurrenceId !== occurrenceId &&
          block.dayIndex === dayIndex &&
          startIndex < block.startIndex + block.span &&
          block.startIndex < startIndex + span,
      );
    },
    [canPlaceClass, dayCount, pageUnderFinger, slotCount, timeSlots, weekdays],
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
      if (columnWidth <= 0 || slotHeight.get() <= 0) return;
      const dayIndex = Math.floor((x - TIME_GUTTER_WIDTH) / columnWidth);
      const slotIndex = Math.floor((y - DAY_HEADER_HEIGHT + scrollY.get()) / slotHeight.get());
      const onGrid = y >= DAY_HEADER_HEIGHT && dayIndex >= 0 && dayIndex < dayCount && slotIndex >= 0 && slotIndex < slotCount;

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
    [columnWidth, dayCount, interaction, openEditorFor, pageUnderFinger, setInteraction, slotCount],
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
   * idle | provisionalSelected --long press on a class--> eventSelected
   * eventSelected --long press on the same class--> movingEvent
   */
  const beginHold = useCallback(
    (occurrenceId: string, dayIndex: number, startIndex: number, span: number) => {
      activationTick();
      const page = pageUnderFinger();
      const alreadySelected =
        interaction.kind === "eventSelected" &&
        interaction.occurrenceId === occurrenceId &&
        interaction.weekStart === page.weekStart;

      const block = page.blocks.find((candidate) => candidate.occurrenceId === occurrenceId);
      // The worklet hit-tests against `hitBlocks`, which is published from an
      // effect and so describes the previous render. A hold that lands on a
      // class the week on screen does not actually contain is that lag, not
      // an intention: selecting it would offer resize handles for a block
      // nobody can see.
      if (!block) {
        setInteraction(IDLE);
        return;
      }
      setSubject({ occurrenceId, name: block.course.name, room: block.course.room, appearanceId: block.course.appearanceId });

      if (!alreadySelected) {
        // Selection only: the class must not move because it was picked.
        setInteraction({ kind: "eventSelected", occurrenceId, weekStart: page.weekStart, dayIndex, startIndex, span });
        return;
      }

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
    [interaction, pageUnderFinger, setInteraction],
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

  /** Day column under a surface-relative x, or -1 in the gutter or past the week. */
  const dayAtX = (x: number): number => {
    "worklet";
    if (columnWidth <= 0) return -1;
    const index = Math.floor((x - TIME_GUTTER_WIDTH) / columnWidth);
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
   * Moves the range being shaped to where the finger is. Runs on the UI
   * thread for every touch sample; JavaScript only hears about it when the
   * snapped range actually changes.
   */
  const applyShaping = (x: number, y: number) => {
    "worklet";
    const height = slotHeight.get();
    if (height <= 0 || columnWidth <= 0) return;

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
      nextStart = clampValue(period, 0, bottom - 1);
      nextSpan = bottom - nextStart;
    } else if (mode === PAN_RESIZE_END) {
      const top = dragFixedEdge.get();
      nextStart = top;
      nextSpan = clampValue(period, top, slotCount - 1) - top + 1;
    } else if (mode === PAN_MOVE) {
      nextDay = clampValue(Math.floor((x - TIME_GUTTER_WIDTH) / columnWidth), 0, dayCount - 1);
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

  /** Hands the shaped range over exactly once, however the gesture ended. */
  const settleShaping = () => {
    "worklet";
    if (dragSettled.get() === 1) return;
    dragSettled.set(1);
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

      // Work out what is under the finger now, while the geometry is still
      // static, so the slop-crossing decision is a lookup rather than a
      // second hit-test against a surface that may have started moving.
      touchTarget.set(targetAt(touch.x, touch.y));

      // Catching a flinging grid stops it where it is, and that touch does
      // not also count as a tap. A page settling towards its week is left
      // to finish; a drag from here simply takes over from its position.
      if (scrollSettling.get() === 1) {
        cancelAnimation(scrollY);
        scrollSettling.set(0);
        suppressTap.set(1);
        return;
      }
      suppressTap.set(pageSettling.get());
    })
    .onTouchesMove((event, manager) => {
      "worklet";
      if (axis.get() === AXIS.pinch) {
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
        axis.set(AXIS.horizontal);
        panMode.set(PAN_PAGE);
        panStartPos.set(pos.get());
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
      if (panMode.get() >= PAN_CREATE) settleShaping();
    })
    .onUpdate((event) => {
      "worklet";
      const mode = panMode.get();

      if (mode === PAN_PAGE) {
        if (size.width <= 0) return;
        pos.set(panStartPos.get() - event.translationX / size.width);
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
      if (mode === PAN_PAGE) {
        if (size.width <= 0) return;
        // Measured from the page the drag started on. Taking it from the
        // committed week instead would misjudge every drag that began while
        // an earlier settle was still running.
        const from = Math.round(panStartPos.get());
        const travelled = pos.get() - from;
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
      // A cancelled gesture — a second finger, a lost pointer — still has to
      // hand back whatever was being shaped; `settleShaping` only runs once.
      if (panMode.get() >= PAN_CREATE) settleShaping();
      if (axis.get() !== AXIS.pinch) axis.set(AXIS.none);
      panMode.set(PAN_NONE);
      touchTarget.set(TARGET_CHROME);
    });

  /**
   * Vertical time scale only. Runs entirely in these worklets: the scale,
   * the scroll offset and the anchored period are all shared values, so a
   * pinch never re-renders the week, never changes which week is current,
   * and never re-keys anything.
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
      suppressTap.set(1);
      axis.set(AXIS.pinch);
      cancelAnimation(scrollY);
      // Freeze paging wherever it is; a pinch must not drift the week.
      cancelAnimation(pos);
      pinchStartSlotHeight.set(slotHeight.get());
      pinchAnchorSlot.set((scrollY.get() + event.focalY - DAY_HEADER_HEIGHT) / slotHeight.get());
      runOnJS(dismissProvisional)();
    })
    .onUpdate((event) => {
      "worklet";
      if (pinchActive.get() !== 1) return;
      const minHeight = minSlotHeightFor(bodyHeight, slotCount);
      const next = clampValue(pinchStartSlotHeight.get() * event.scale, minHeight, MAX_SLOT_HEIGHT);
      slotHeight.set(next);
      scrollY.set(clampValue(
        pinchAnchorSlot.get() * next - (event.focalY - DAY_HEADER_HEIGHT),
        0,
        maxScrollFor(next, slotCount, bodyHeight),
      ));
    })
    .onFinalize(() => {
      "worklet";
      pinchActive.set(0);
      if (axis.get() === AXIS.pinch) {
        axis.set(AXIS.none);
        // A pinch can leave the pager fractionally off if it interrupted a
        // settle; put it back on the nearest whole page. That page is
        // whichever one is on screen — the pinch froze the pager, it did not
        // undo the swipe that was already under way — so the week is
        // reconciled to it rather than dragged back to the previous one.
        const settled = Math.round(pos.get());
        if (pos.get() !== settled) {
          pageSettling.set(1);
          pos.set(
            withSpring(settled, PAGE_SPRING, () => {
              pageSettling.set(0);
              runOnJS(reconcilePage)();
            }),
          );
        } else {
          runOnJS(reconcilePage)();
        }
      }
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
   * On empty grid it opens a range to drag out. On a class that is not
   * selected yet it only selects it: the class must not move because it was
   * picked up. Holding the class that is already selected is the separate,
   * deliberate act that starts a move.
   */
  const hold = Gesture.LongPress()
    .minDuration(BLOCK_LONG_PRESS_MS)
    // Beyond this the finger is moving, not holding, and the pan owns it.
    .maxDistance(TOUCH_SLOP)
    .onStart((event) => {
      "worklet";
      if (axis.get() !== AXIS.none || panMode.get() !== PAN_NONE || pinchActive.get() === 1) return;

      const target = targetAt(event.x, event.y);
      // A handle is aimed at, not held: holding one must stay a resize.
      if (target !== TARGET_EMPTY && target !== TARGET_BLOCK) return;

      const dayIndex = dayAtX(event.x);
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
      // class to hold there is nothing to select, and the tap still stands.
      if (!hit || hit.occurrenceId === null) return;

      axis.set(AXIS.block);
      suppressTap.set(1);
      dragSettled.set(0);
      labelBelow.set(0);

      const selection = selectionSV.get();
      const alreadySelected =
        selection !== null && selection.occurrenceId === hit.occurrenceId && interactionSV.get() === INTERACTION.eventSelected;

      dragDay.set(hit.dayIndex);
      dragStart.set(hit.startIndex);
      dragSpan.set(hit.span);
      // Keep the grab point inside the block, so it does not jump under the
      // finger when the move starts.
      dragGrabOffset.set(slotFloat - hit.startIndex);
      // A hold that only selects leaves nothing to drag afterwards; the
      // second hold on the same class is what starts a move.
      panMode.set(alreadySelected ? PAN_MOVE : PAN_HELD);
      interactionSV.set(alreadySelected ? INTERACTION.movingEvent : INTERACTION.eventSelected);
      runOnJS(beginHold)(hit.occurrenceId, hit.dayIndex, hit.startIndex, hit.span);
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
   * Nothing races here. Each gesture decides for itself whether it is
   * allowed to act, from shared values the others have already written, so
   * the priority — pinch, then resize or move, then the hold, then scroll
   * and page, then tap — is explicit rather than left to whichever native
   * recognizer happens to reach its threshold first.
   */
  const gesture = Gesture.Simultaneous(pinch, hold, pan, tap);

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
                  slotHeight={slotHeight}
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
              scrollY={scrollY}
            />

            <ManipulationOverlay
              interaction={interaction}
              subject={subject}
              timeSlots={timeSlots}
              columnWidth={columnWidth}
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
