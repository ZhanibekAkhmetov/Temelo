import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";

import { getAppearanceColors } from "@/theme/tokens";
import { useTheme } from "@/theme/useTheme";

const BLOCK_INSET = 1.5;
/** Outlines sit a little further in, so all four edges clear the day rules. */
const OUTLINE_INSET = 2.5;
const OUTLINE_WIDTH = 2;

export type BlockVariant = "class" | "provisional" | "dragging";

interface GridBlockProps {
  startIndex: number;
  span: number;
  /** Live span during a resize, so the height follows the finger directly. */
  spanShared?: SharedValue<number>;
  /** Live start during a resize or move, so the top edge follows the finger. */
  startShared?: SharedValue<number>;
  left: number;
  width: number;
  slotHeight: SharedValue<number>;
  appearanceId?: string;
  name?: string;
  room?: string;
  variant: BlockVariant;
  accessibilityLabel?: string;
}

/**
 * One block on the grid.
 *
 * Vertical placement is a transform and only the height is a layout prop,
 * so a pinch costs one measured node per block instead of a full re-render.
 * Not touchable itself: the surface owns all hit-testing, which keeps taps,
 * drags and paging inside one arbitration.
 */
export function GridBlock({
  startIndex,
  span,
  spanShared,
  startShared,
  left,
  width,
  slotHeight,
  appearanceId,
  name,
  room,
  variant,
  accessibilityLabel,
}: GridBlockProps) {
  const { colors, radii, typography, scheme } = useTheme();

  const appearance = appearanceId ? getAppearanceColors(appearanceId, scheme) : null;
  const isPreview = variant !== "class";

  const style = useAnimatedStyle(() => {
    const currentSpan = spanShared ? spanShared.get() : span;
    const currentStart = startShared ? startShared.get() : startIndex;
    const height = slotHeight.get();
    return {
      height: Math.max(0, currentSpan * height - BLOCK_INSET * 2),
      transform: [{ translateY: currentStart * height + BLOCK_INSET }],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.block,
        {
          left: left + BLOCK_INSET,
          width: Math.max(0, width - BLOCK_INSET * 2),
          borderRadius: radii.sm,
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
          shadowColor: "#000000",
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
        <View style={styles.content}>
          <Text style={[typography.gridText, { color: appearance ? appearance.ink : colors.textPrimary }]} numberOfLines={2}>
            {name}
          </Text>
          {room ? (
            <Text
              style={[typography.gridSecondary, { color: appearance ? appearance.inkMuted : colors.textSecondary }]}
              numberOfLines={1}
            >
              {room}
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
  left: number;
  width: number;
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
  left,
  width,
  slotHeight,
  color,
  withHandles,
}: SelectionOutlineProps) {
  const { colors, radii } = useTheme();
  const stroke = color ?? colors.accent;

  const style = useAnimatedStyle(() => {
    const currentSpan = spanShared ? spanShared.get() : span;
    const currentStart = startShared ? startShared.get() : startIndex;
    const height = slotHeight.get();
    return {
      height: Math.max(0, currentSpan * height - OUTLINE_INSET * 2),
      transform: [{ translateY: currentStart * height + OUTLINE_INSET }],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.outline,
        {
          left: left + OUTLINE_INSET,
          width: Math.max(0, width - OUTLINE_INSET * 2),
          borderColor: stroke,
          borderWidth: OUTLINE_WIDTH,
          borderRadius: radii.sm,
        },
        style,
      ]}
    >
      {withHandles ? (
        <>
          <View style={[styles.handle, styles.handleTop, { backgroundColor: colors.background, borderColor: stroke }]} />
          <View style={[styles.handle, styles.handleBottom, { backgroundColor: colors.background, borderColor: stroke }]} />
        </>
      ) : null}
    </Animated.View>
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
