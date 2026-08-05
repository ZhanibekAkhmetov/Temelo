import { Pressable, StyleSheet, Text, View } from "react-native";

import { getAppearanceColors } from "@/theme/tokens";
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
  content: GridCellContent | null;
  onPress: () => void;
  accessibilityLabel: string;
}

/** Below this a cell only has room for the class name, not the room too. */
const ROOM_LINE_MIN_HEIGHT = 52;

export function GridCell({ width, height, isToday, content, onPress, accessibilityLabel }: GridCellProps) {
  const { colors, radii, typography, borderWidth, scheme } = useTheme();

  const appearance = content ? getAppearanceColors(content.appearanceId, scheme) : null;
  const showRoom = Boolean(content?.room) && height >= ROOM_LINE_MIN_HEIGHT;

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
          borderColor: colors.border,
          borderRightWidth: borderWidth.thin,
          borderBottomWidth: borderWidth.thin,
          backgroundColor: isToday ? colors.todayBackground : "transparent",
          opacity: pressed ? 0.6 : 1,
        },
      ]}
    >
      {content && appearance ? (
        // A complete rectangle on all four sides, inset inside the cell — it
        // never borrows the grid's own cell border for an edge.
        <View
          style={[
            styles.block,
            { backgroundColor: appearance.fill, borderRadius: radii.sm, borderColor: appearance.edge, borderWidth: 1 },
          ]}
        >
          <View style={styles.blockContent}>
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
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cell: {
    padding: 2,
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
});
