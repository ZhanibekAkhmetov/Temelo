import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { BackHandler, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { cancelAnimation, runOnJS, useSharedValue, withDecay, withSpring } from "react-native-reanimated";

import { addWeeksIso, weekDatesFrom } from "@/domain/calendar";
import { findCurrentPeriodIndex } from "@/domain/time";
import { resolveWeekBlocks } from "@/domain/timetable";
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
import type { Course, Placement, TimeSlot } from "@/types/models";

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
}

interface TimetableSurfaceProps {
  /** Week the page range is centred on; index 0 is the current week. */
  anchorWeekStart: string;
  weekdays: Weekday[];
  timeSlots: TimeSlot[];
  placements: Placement[];
  courses: Course[];
  today: string;
  now: string;
  onVisibleWeekChange: (weekStartIso: string) => void;
  onOpenEditor: (selection: SelectedCell) => void;
  onMoveClass: (input: PlacementPosition) => void;
  /** Whether a proposed position is free, checked against recurrence overlap. */
  canPlaceClass: (input: PlacementPosition) => boolean;
  ref?: Ref<TimetableSurfaceHandle>;
}

export interface PlacementPosition {
  placementId: string;
  weekday: Weekday;
  timeSlotId: string;
  slotSpan: number;
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
    () => resolveWeekBlocks({ weekdays, dates: visibleDates, placements, courses, timeSlots }),
    [weekdays, visibleDates, placements, courses, timeSlots],
  );

  // Hit-testing data for the gesture worklets: only the week on screen can
  // be touched, so only that week's blocks are published.
  useEffect(() => {
    hitBlocks.set(
      visibleBlocks.map((block) => ({
        placementId: block.placement.id,
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
            placementId: interaction.kind === "eventSelected" ? interaction.placementId : null,
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

  /** The settled week only changes here, once a page has stopped moving. */
  const commitWeek = useCallback(
    (direction: number) => {
      if (direction === 0) return;
      const next = baseIdx.get() + direction;
      baseIdx.set(next);
      setBaseIndex(next);
      onVisibleWeekChange(addWeeksIso(anchorWeekStart, next));
    },
    [anchorWeekStart, baseIdx, onVisibleWeekChange],
  );

  const goToPage = useCallback(
    (target: number) => {
      const distance = target - baseIdx.get();
      if (distance === 0) return;

      // Only the neighbouring weeks are mounted, so anything further away
      // is a jump rather than a slide: position and week change together
      // and the destination is rendered directly.
      if (Math.abs(distance) > 1) {
        baseIdx.set(target);
        pos.set(target);
        setBaseIndex(target);
        onVisibleWeekChange(addWeeksIso(anchorWeekStart, target));
        return;
      }

      // One week away is the same animation and the same settlement path a
      // swipe takes: spring first, commit the logical week on arrival.
      const step = Math.sign(distance);
      pageSettling.set(1);
      pos.set(
        withSpring(baseIdx.get() + step, PAGE_SPRING, (finished) => {
          pageSettling.set(0);
          if (finished) runOnJS(commitWeek)(step);
        }),
      );
    },
    [anchorWeekStart, baseIdx, commitWeek, onVisibleWeekChange, pageSettling, pos],
  );

  useImperativeHandle(
    ref,
    () => ({
      goToRelativeWeek: (offset: number) => goToPage(baseIdx.get() + offset),
      goToCurrentWeek: () => goToPage(0),
    }),
    [baseIdx, goToPage],
  );

  /**
   * Whether a proposed range is free. An existing class is checked against
   * recurrence overlap through the store; a range that has no placement yet
   * is checked against what actually meets in the week on screen.
   */
  const rangeIsFree = useCallback(
    (placementId: string | null, dayIndex: number, startIndex: number, span: number): boolean => {
      if (dayIndex < 0 || dayIndex >= dayCount || startIndex < 0 || startIndex + span > slotCount) return false;
      if (placementId) {
        return canPlaceClass({
          placementId,
          weekday: weekdays[dayIndex],
          timeSlotId: timeSlots[startIndex].id,
          slotSpan: span,
        });
      }
      return !visibleBlocks.some(
        (block) =>
          block.dayIndex === dayIndex && startIndex < block.startIndex + block.span && block.startIndex < startIndex + span,
      );
    },
    [canPlaceClass, dayCount, slotCount, timeSlots, visibleBlocks, weekdays],
  );

  const openEditorFor = useCallback(
    (dayIndex: number, startIndex: number, span: number, placementId: string | null) => {
      const weekday = weekdays[dayIndex];
      const existing = placementId ? visibleBlocks.find((block) => block.placement.id === placementId) : undefined;
      setInteractionState(IDLE);
      onOpenEditor({
        weekday,
        date: visibleDates[weekday],
        timeSlot: timeSlots[startIndex],
        slotSpan: span,
        endTime: timeSlots[Math.min(slotCount - 1, startIndex + span - 1)].endTime,
        existing: existing ? { placement: existing.placement, course: existing.course } : undefined,
      });
    },
    [onOpenEditor, slotCount, timeSlots, visibleBlocks, visibleDates, weekdays],
  );

  /**
   * The provisional block is a suggestion, not a commitment: anything that
   * says "I meant to look somewhere else" — scrolling, paging, pinching —
   * takes it away again. A selected class is left alone by those, because
   * scrolling to its handles is part of resizing it.
   */
  const dismissProvisional = useCallback(() => {
    setInteractionState((current) => (current.kind === "provisionalSelected" ? IDLE : current));
  }, []);

  /** Android Back clears whatever is provisional or selected before it leaves. */
  useEffect(() => {
    if (interaction.kind === "idle") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setInteractionState(IDLE);
      return true;
    });
    return () => subscription.remove();
  }, [interaction.kind]);

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
        setInteractionState(IDLE);
        return;
      }

      const existing = visibleBlocks.find(
        (block) => block.dayIndex === dayIndex && slotIndex >= block.startIndex && slotIndex < block.startIndex + block.span,
      );
      if (existing) {
        openEditorFor(existing.dayIndex, existing.startIndex, existing.span, existing.placement.id);
        return;
      }

      const active = interaction;
      const insideActive =
        (active.kind === "provisionalSelected" || active.kind === "eventSelected") &&
        active.weekStart === visibleWeekStart &&
        active.dayIndex === dayIndex &&
        slotIndex >= active.startIndex &&
        slotIndex < active.startIndex + active.span;

      if (insideActive && active.kind === "provisionalSelected") {
        openEditorFor(active.dayIndex, active.startIndex, active.span, null);
        return;
      }

      setInteractionState({ kind: "provisionalSelected", weekStart: visibleWeekStart, dayIndex, startIndex: slotIndex, span: 1 });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columnWidth, dayCount, interaction, openEditorFor, slotCount, visibleBlocks, visibleWeekStart],
  );

  /** idle | provisionalSelected --long press on empty grid--> creatingRange */
  const beginCreateRange = useCallback(
    (dayIndex: number, anchorIndex: number) => {
      activationTick();
      setSubject(null);
      setInteractionState({
        kind: "creatingRange",
        weekStart: visibleWeekStart,
        dayIndex,
        anchorIndex,
        startIndex: anchorIndex,
        span: 1,
        valid: rangeIsFree(null, dayIndex, anchorIndex, 1),
      });
    },
    [rangeIsFree, visibleWeekStart],
  );

  /** eventSelected --handle drag--> resizingStart | resizingEnd */
  const beginResize = useCallback(
    (edge: "start" | "end", placementId: string, dayIndex: number, startIndex: number, span: number) => {
      const origin: RangeGeometry = { weekStart: visibleWeekStart, dayIndex, startIndex, span };
      const block = visibleBlocks.find((candidate) => candidate.placement.id === placementId);
      setSubject(
        block
          ? { placementId, name: block.course.name, room: block.course.room, appearanceId: block.course.appearanceId }
          : { placementId },
      );
      setInteractionState({
        kind: edge === "start" ? "resizingStart" : "resizingEnd",
        placementId,
        origin,
        weekStart: visibleWeekStart,
        dayIndex,
        startIndex,
        span,
        valid: true,
      });
    },
    [visibleBlocks, visibleWeekStart],
  );

  /**
   * idle | provisionalSelected --long press on a class--> eventSelected
   * eventSelected --long press on the same class--> movingEvent
   */
  const beginHold = useCallback(
    (placementId: string, dayIndex: number, startIndex: number, span: number) => {
      activationTick();
      const alreadySelected =
        interaction.kind === "eventSelected" &&
        interaction.placementId === placementId &&
        interaction.weekStart === visibleWeekStart;

      const block = visibleBlocks.find((candidate) => candidate.placement.id === placementId);
      setSubject(
        block
          ? { placementId, name: block.course.name, room: block.course.room, appearanceId: block.course.appearanceId }
          : { placementId },
      );

      if (!alreadySelected) {
        // Selection only: the class must not move because it was picked.
        setInteractionState({ kind: "eventSelected", placementId, weekStart: visibleWeekStart, dayIndex, startIndex, span });
        return;
      }

      setInteractionState({
        kind: "movingEvent",
        placementId,
        origin: { weekStart: visibleWeekStart, dayIndex, startIndex, span },
        weekStart: visibleWeekStart,
        dayIndex,
        startIndex,
        span,
        valid: true,
      });
    },
    [interaction, visibleBlocks, visibleWeekStart],
  );

  /** One boundary crossed: tick once, and re-check the proposed range. */
  const handleDetent = useCallback(
    (dayIndex: number, startIndex: number, span: number) => {
      selectionTick();
      setInteractionState((current) => {
        if (current.kind === "creatingRange") {
          return { ...current, dayIndex, startIndex, span, valid: rangeIsFree(null, dayIndex, startIndex, span) };
        }
        if (current.kind === "resizingStart" || current.kind === "resizingEnd" || current.kind === "movingEvent") {
          return { ...current, dayIndex, startIndex, span, valid: rangeIsFree(current.placementId, dayIndex, startIndex, span) };
        }
        return current;
      });
    },
    [rangeIsFree],
  );

  /**
   * creatingRange --release--> provisionalSelected (dropped if it overlaps)
   * resizing* | movingEvent --release--> eventSelected, committed only when
   * the proposed range is free.
   */
  const finishManipulation = useCallback(
    (dayIndex: number, startIndex: number, span: number) => {
      setSubject(null);
      setInteractionState((current) => {
        if (current.kind === "creatingRange") {
          if (!rangeIsFree(null, dayIndex, startIndex, span)) return IDLE;
          return { kind: "provisionalSelected", weekStart: current.weekStart, dayIndex, startIndex, span };
        }

        if (current.kind !== "resizingStart" && current.kind !== "resizingEnd" && current.kind !== "movingEvent") {
          return current;
        }

        const { origin, placementId } = current;
        const unchanged = dayIndex === origin.dayIndex && startIndex === origin.startIndex && span === origin.span;
        if (!placementId || unchanged || !rangeIsFree(placementId, dayIndex, startIndex, span)) {
          return placementId
            ? { kind: "eventSelected", placementId, ...origin }
            : { kind: "provisionalSelected", ...origin };
        }

        onMoveClass({
          placementId,
          weekday: weekdays[dayIndex],
          timeSlotId: timeSlots[startIndex].id,
          slotSpan: span,
        });
        return { kind: "eventSelected", placementId, weekStart: origin.weekStart, dayIndex, startIndex, span };
      });
    },
    [onMoveClass, rangeIsFree, timeSlots, weekdays],
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
    if (selection && selection.placementId !== null && selection.dayIndex === dayIndex) {
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
      if ((target === TARGET_HANDLE_START || target === TARGET_HANDLE_END) && selection && selection.placementId !== null) {
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
          selection.placementId,
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
        // Return to the week that is already current instead of committing
        // one, and let the fling die where it is.
        if (mode === PAN_PAGE) {
          pageSettling.set(1);
          pos.set(
            withSpring(baseIdx.get(), PAGE_SPRING, () => {
              pageSettling.set(0);
            }),
          );
        }
        return;
      }
      if (mode === PAN_PAGE) {
        if (size.width <= 0) return;
        const travelled = pos.get() - baseIdx.get();
        const velocityPages = -event.velocityX / size.width;
        const projected = travelled + velocityPages * PAGE_VELOCITY_PROJECTION_SECONDS;

        let direction = 0;
        if (Math.abs(velocityPages) >= PAGE_FLICK_VELOCITY) direction = velocityPages > 0 ? 1 : -1;
        else if (Math.abs(projected) >= PAGE_COMMIT_FRACTION) direction = projected > 0 ? 1 : -1;

        // The release velocity is handed straight to the spring, so the
        // settle is a continuation of the drag rather than a new animation.
        pageSettling.set(1);
        pos.set(
          withSpring(baseIdx.get() + direction, { ...PAGE_SPRING, velocity: velocityPages }, (finished) => {
            pageSettling.set(0);
            if (finished && direction !== 0) runOnJS(commitWeek)(direction);
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
        // settle; put it back on its own week without committing anything.
        if (pos.get() !== baseIdx.get()) {
          pageSettling.set(1);
          pos.set(
            withSpring(baseIdx.get(), PAGE_SPRING, () => {
              pageSettling.set(0);
            }),
          );
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
      if (!hit || hit.placementId === null) return;

      axis.set(AXIS.block);
      suppressTap.set(1);
      dragSettled.set(0);
      labelBelow.set(0);

      const selection = selectionSV.get();
      const alreadySelected =
        selection !== null && selection.placementId === hit.placementId && interactionSV.get() === INTERACTION.eventSelected;

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
      runOnJS(beginHold)(hit.placementId, hit.dayIndex, hit.startIndex, hit.span);
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
  const hiddenPlacementId = live ? (subject?.placementId ?? null) : null;

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
                  today={today}
                  now={now}
                  width={size.width}
                  columnWidth={columnWidth}
                  slotHeight={slotHeight}
                  scrollY={scrollY}
                  hiddenPlacementId={hiddenPlacementId}
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
