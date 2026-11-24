import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";

import { TIME_GUTTER_WIDTH } from "@/features/timetable/geometry";
import { getClassColors } from "@/theme/classColors";
import { useIsDesktop } from "@/theme/useIsDesktop";
import { useTheme } from "@/theme/useTheme";

const BLOCK_INSET = 1.5;
/** Outlines sit a little further in, so all four edges clear the day rules. */
const OUTLINE_INSET = 2.5;
const OUTLINE_WIDTH = 2;

/**
 * Desktop: the strip at the trailing edge of every day column that no block
 * covers.
 *
 * On a phone a block fills its cell, because the cell is a thumb wide and every
 * point of it is worth the text. On a desktop the columns are several times
 * wider, and a block that fills one edge to edge reads as a painted cell rather
 * than as a class sitting in a day — so, like a desktop calendar's events,
 * blocks stop short of the next column and the day's own background shows down
 * its side.
 */
const DESKTOP_TRAILING_GAP = 12;
/** Desktop: the gap above and below a block, so back-to-back classes read as two. */
const DESKTOP_VERTICAL_INSET = 2;

/** How a block sits inside its cell — one geometry per layout. */
interface BlockInsets {
  /** Left and right inset of each lane. */
  horizontal: number;
  vertical: number;
  /** Width at the end of the column no lane uses. */
  trailing: number;
}

function blockInsets(isDesktop: boolean, base: number): BlockInsets {
  return isDesktop
    ? { horizontal: base, vertical: Math.max(base, DESKTOP_VERTICAL_INSET), trailing: DESKTOP_TRAILING_GAP }
    : { horizontal: base, vertical: base, trailing: 0 };
}

export type BlockVariant = "class" | "provisional" | "dragging";

interface GridBlockProps {
  startIndex: number;
  span: number;
  /** Live span during a resize, so the height follows the finger directly. */
  spanShared?: SharedValue<number>;
  /** Live start during a resize or move, so the top edge follows the finger. */
  startShared?: SharedValue<number>;
  /** Column the block sits in; the drag overlay draws in its own column and passes 0. */
  dayIndex: number;
  /**
   * Side-by-side lane inside the column, and how many lanes share it. A class
   * nothing overlaps is lane 0 of 1 — the whole column.
   */
  lane?: number;
  laneCount?: number;
  /** Live column width, so a horizontal zoom widens the block itself. */
  columnWidth: SharedValue<number>;
  slotHeight: SharedValue<number>;
  appearanceId?: string;
  name?: string;
  room?: string;
  /**
   * "09:20–10:50". Drawn only in the desktop layout, where a block is wide
   * enough to say when it is as well as what; on a phone the gutter beside
   * the row already says it.
   */
  timeRange?: string;
  /** Lines the name may use at the settled zoom level; taller blocks get more. */
  nameLines?: number;
  variant: BlockVariant;
  accessibilityLabel?: string;
}

/**
 * One block on the grid.
 *
 * Both of its dimensions are real layout props driven from shared values,
 * and only its position is a transform. A pinch therefore gives the block's
 * text genuinely more room — it re-wraps inside the wider, taller box —
 * rather than magnifying a box whose text layout was fixed at the old size.
 * Not touchable itself: the surface owns all hit-testing, which keeps taps,
 * drags and paging inside one arbitration.
 */
export function GridBlock({
  startIndex,
  span,
  spanShared,
  startShared,
  dayIndex,
  lane = 0,
  laneCount = 1,
  columnWidth,
  slotHeight,
  appearanceId,
  name,
  room,
  timeRange,
  nameLines,
  variant,
  accessibilityLabel,
}: GridBlockProps) {
  const { colors, radii, typography } = useTheme();
  const isDesktop = useIsDesktop();
  const insets = blockInsets(isDesktop, BLOCK_INSET);
  const { horizontal, vertical, trailing } = insets;

  // One palette for both schemes, so `scheme` is not consulted here at all.
  const appearance = appearanceId ? getClassColors(appearanceId) : null;
  const isPreview = variant !== "class";

  const style = useAnimatedStyle(() => {
    const currentSpan = spanShared ? spanShared.get() : span;
    const currentStart = startShared ? startShared.get() : startIndex;
    const height = slotHeight.get();
    const width = columnWidth.get();
    // Lanes split the column evenly; each lane keeps the same inset on both
    // sides, so two blocks side by side have a visible gap between them.
    const laneWidth = Math.max(0, width - trailing) / Math.max(1, laneCount);
    return {
      width: Math.max(0, laneWidth - horizontal * 2),
      height: Math.max(0, currentSpan * height - vertical * 2),
      transform: [
        { translateX: dayIndex * width + lane * laneWidth },
        { translateY: currentStart * height + vertical },
      ],
    };
  });

  // A lane too narrow for a word reads better as a coloured strip than as two
  // clipped letters, so the room line goes first and then the name's wrap.
  const narrow = laneCount > 1;
  // Desktop: when, then where, on one line under the name.
  const detail = isDesktop ? [timeRange, room].filter(Boolean).join(" · ") : room;

  return (
    <Animated.View
      pointerEvents="none"
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.block,
        {
          left: TIME_GUTTER_WIDTH + horizontal,
          borderRadius: isDesktop ? radii.md : radii.sm,
          // A proposed range is a translucent wash, so it can never be
          // mistaken for a class that is actually there.
          backgroundColor: variant === "provisional" || !appearance ? colors.provisionalFill : appearance.fill,
          // One hairline of the course's own colour, darkened, is all the
          // definition a block needs; the selection outline is what stands out.
          borderColor: isPreview || !appearance ? "transparent" : appearance.edge,
          borderWidth: isPreview ? 0 : StyleSheet.hairlineWidth,
          opacity: variant === "dragging" ? 0.96 : 1,
          elevation: variant === "dragging" ? 6 : 0,
          shadowOpacity: variant === "dragging" ? 0.18 : 0,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 3 },
          shadowColor: colors.shadow,
        },
        style,
      ]}
    >
      {variant === "provisional" && !name ? (
        <View style={styles.center}>
          <Text style={[styles.plus, { color: colors.accent }]}>+</Text>
        </View>
      ) : (
        // Name at the top-left, room under it: the shape of the block is
        // what says how long the class is, so the text stays out of the way.
        <View style={[styles.content, isDesktop && styles.contentDesktop]}>
          <Text
            style={[
              typography.gridText,
              isDesktop && styles.nameDesktop,
              { color: appearance ? appearance.ink : colors.textPrimary },
            ]}
            numberOfLines={nameLines ?? 2}
          >
            {name}
          </Text>
          {detail && !narrow ? (
            <Text
              style={[
                typography.gridSecondary,
                isDesktop && styles.detailDesktop,
                { color: appearance ? appearance.inkMuted : colors.textSecondary },
              ]}
              numberOfLines={1}
            >
              {detail}
            </Text>
          ) : null}
        </View>
      )}
    </Animated.View>
  );
}

/** Visible size of a resize handle; the touch target around it is far larger. */
export const HANDLE_VISUAL_SIZE = 12;
/** How far from an edge a touch still counts as grabbing its handle. */
export const HANDLE_TOUCH_RADIUS = 22;

interface SelectionOutlineProps {
  startIndex: number;
  span: number;
  spanShared?: SharedValue<number>;
  /** Live start during a resize or move, so the outline tracks the finger. */
  startShared?: SharedValue<number>;
  dayIndex: number;
  /** The selected class's lane, so the outline rings that class and not its neighbours. */
  lane?: number;
  laneCount?: number;
  columnWidth: SharedValue<number>;
  slotHeight: SharedValue<number>;
  color?: string;
  /** Draws the circular start/end handles of a selected class. */
  withHandles?: boolean;
}

/**
 * The rectangle around a provisional or just-placed range. Drawn as its own
 * layer above the blocks — never out of a day-column rule — and inset on
 * every side so the left and right edges stay clear of the column
 * boundaries, including in the first column.
 */
export function SelectionOutline({
  startIndex,
  span,
  spanShared,
  startShared,
  dayIndex,
  lane = 0,
  laneCount = 1,
  columnWidth,
  slotHeight,
  color,
  withHandles,
}: SelectionOutlineProps) {
  const { colors, radii } = useTheme();
  const stroke = color ?? colors.accent;
  // The same geometry as the block it rings, so it rings that block exactly.
  const isDesktop = useIsDesktop();
  const { horizontal, vertical, trailing } = blockInsets(isDesktop, OUTLINE_INSET);

  const style = useAnimatedStyle(() => {
    const currentSpan = spanShared ? spanShared.get() : span;
    const currentStart = startShared ? startShared.get() : startIndex;
    const height = slotHeight.get();
    const width = columnWidth.get();
    const laneWidth = Math.max(0, width - trailing) / Math.max(1, laneCount);
    return {
      width: Math.max(0, laneWidth - horizontal * 2),
      height: Math.max(0, currentSpan * height - vertical * 2),
      transform: [
        { translateX: dayIndex * width + lane * laneWidth },
        { translateY: currentStart * height + vertical },
      ],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.outline,
        {
          left: TIME_GUTTER_WIDTH + horizontal,
          borderColor: stroke,
          borderWidth: OUTLINE_WIDTH,
          borderRadius: isDesktop ? radii.md : radii.sm,
        },
        style,
      ]}
    >
      {withHandles ? (
        <>
          <ResizeHandle style={styles.handleTop} />
          <ResizeHandle style={styles.handleBottom} />
        </>
      ) : null}
    </Animated.View>
  );
}

/**
 * One grab handle on the selection rectangle.
 *
 * Its two colours come from the theme, not from the class — deliberately, and
 * this is the one place the selection chrome parts company with the course's
 * own hue. A handle straddles the block's edge: half of it lies on the fill,
 * half on the grid behind it. A hue-derived handle can be readable against
 * one of those two grounds but not reliably against both — a pale ring that
 * stands out on a deep purple block vanishes on the white page a few pixels
 * above it.
 *
 * `selectionHandle` against `selectionBorder` is legible on the page by
 * construction, and on *every* fill in the palette at least one of the two
 * contrasts strongly: the near-black ring carries it on amber and the bright
 * greens, the light fill carries it on purple, indigo and the deep blues. So
 * the handles stay visible whatever colour the class is and whichever scheme
 * is in force, which is what a resize affordance has to do.
 */
function ResizeHandle({ style }: { style: object }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.handle,
        style,
        { backgroundColor: colors.selectionHandle, borderColor: colors.selectionBorder },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  block: {
    position: "absolute",
    top: 0,
    overflow: "hidden",
  },
  outline: {
    // Drawn last and lifted above the blocks; no elevation, which on
    // Android would add a shadow to a transparent box.
    position: "absolute",
    top: 0,
    zIndex: 3,
    backgroundColor: "transparent",
  },
  handle: {
    position: "absolute",
    alignSelf: "center",
    width: HANDLE_VISUAL_SIZE,
    height: HANDLE_VISUAL_SIZE,
    borderRadius: HANDLE_VISUAL_SIZE / 2,
    borderWidth: OUTLINE_WIDTH,
  },
  handleTop: {
    top: -(HANDLE_VISUAL_SIZE / 2 + OUTLINE_WIDTH / 2),
  },
  handleBottom: {
    bottom: -(HANDLE_VISUAL_SIZE / 2 + OUTLINE_WIDTH / 2),
  },
  content: {
    flex: 1,
    justifyContent: "flex-start",
    paddingHorizontal: 5,
    paddingVertical: 3,
  },
  contentDesktop: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 2,
  },
  nameDesktop: {
    fontSize: 13,
    fontWeight: "600",
  },
  detailDesktop: {
    fontSize: 12,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  plus: {
    fontSize: 22,
    lineHeight: 24,
    fontWeight: "300",
  },
});
