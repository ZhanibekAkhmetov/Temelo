import { Pressable, StyleSheet, Text, View } from "react-native";

import { getClassColors } from "@/theme/classColors";
import { useTheme } from "@/theme/useTheme";

interface GridCellContent {
  name: string;
  room: string;
  appearanceId: string;
}

interface GridCellProps {
  width: number;
  height: number;
  isToday: boolean;
  /**
   * Every class drawn in this cell, in layout order. Empty for a free slot;
   * more than one where classes overlap.
   */
  contents: GridCellContent[];
  onPress: () => void;
  accessibilityLabel: string;
}

/** Below this a cell only has room for the class name, not the room too. */
const ROOM_LINE_MIN_HEIGHT = 52;

/**
 * Most classes stacked inside one cell before the rest collapse into "+N".
 * A row is at most 84 points tall; two one-line blocks fit it legibly, three
 * would not. Every class stays reachable through the tap either way.
 */
const MAX_STACKED = 2;

export function GridCell({ width, height, isToday, contents, onPress, accessibilityLabel }: GridCellProps) {
  const { colors, radii, typography, borderWidth } = useTheme();

  const stacked = contents.length > 1;
  const visible = contents.length > MAX_STACKED ? contents.slice(0, MAX_STACKED - 1) : contents;
  const hiddenCount = contents.length - visible.length;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.cell,
        {
          width,
          height,
          borderColor: colors.gridMinor,
          borderRightWidth: borderWidth.thin,
          borderBottomWidth: borderWidth.thin,
          backgroundColor: isToday ? colors.accentSubtle : "transparent",
          opacity: pressed ? 0.6 : 1,
        },
      ]}
    >
      {/* Overlapping classes are stacked, each a complete block of its own,
          so neither one is drawn over the other or lost under it. */}
      <View style={[styles.stack, { gap: stacked ? 2 : 0 }]}>
        {visible.map((content, index) => {
          const appearance = getClassColors(content.appearanceId);
          const showRoom = !stacked && Boolean(content.room) && height >= ROOM_LINE_MIN_HEIGHT;
          return (
            // A complete rectangle on all four sides, inset inside the cell — it
            // never borrows the grid's own cell border for an edge.
            <View
              key={index}
              style={[
                styles.block,
                { backgroundColor: appearance.fill, borderRadius: radii.sm, borderColor: appearance.edge, borderWidth: 1 },
              ]}
            >
              <View style={stacked ? styles.blockContentCompact : styles.blockContent}>
                <Text style={[typography.gridText, { color: appearance.ink }]} numberOfLines={showRoom ? 2 : 1}>
                  {content.name}
                </Text>
                {showRoom ? (
                  <Text style={[typography.gridSecondary, { color: appearance.inkMuted }]} numberOfLines={1}>
                    {content.room}
                  </Text>
                ) : null}
              </View>
            </View>
          );
        })}
        {hiddenCount > 0 ? (
          <View style={[styles.block, styles.more, { borderRadius: radii.sm, borderColor: colors.gridMinor, backgroundColor: colors.surfaceMuted }]}>
            <Text style={[typography.gridSecondary, { color: colors.textSecondary }]} numberOfLines={1}>
              +{hiddenCount}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cell: {
    padding: 2,
  },
  stack: {
    flex: 1,
  },
  block: {
    flex: 1,
    overflow: "hidden",
  },
  blockContent: {
    flex: 1,
    justifyContent: "flex-start",
    paddingHorizontal: 5,
    paddingVertical: 3,
  },
  blockContentCompact: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  more: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
});
