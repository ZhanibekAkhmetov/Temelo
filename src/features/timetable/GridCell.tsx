import { Pressable, StyleSheet, Text, View } from "react-native";

import { getAppearanceAccent } from "@/theme/tokens";
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

export function GridCell({ width, height, isToday, content, onPress, accessibilityLabel }: GridCellProps) {
  const { colors, spacing, radii, typography, borderWidth, scheme } = useTheme();

  const accent = content ? getAppearanceAccent(content.appearanceId, scheme) : undefined;

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
          borderWidth: borderWidth.thin,
          backgroundColor: isToday ? colors.todayBackground : content ? colors.surface : colors.background,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      {content ? (
        <View style={[styles.filled, { borderLeftColor: accent, borderLeftWidth: 3, paddingLeft: spacing.xs }]}>
          <Text style={[typography.gridText, { color: colors.textPrimary }]} numberOfLines={2}>
            {content.name}
          </Text>
          {content.room ? (
            <Text style={[typography.gridSecondary, { color: colors.textSecondary }]} numberOfLines={1}>
              {content.room}
            </Text>
          ) : null}
        </View>
      ) : (
        <View style={[styles.empty, { borderRadius: radii.sm }]} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cell: {
    padding: 3,
    justifyContent: "center",
  },
  filled: {
    flex: 1,
    justifyContent: "center",
  },
  empty: {
    flex: 1,
  },
});
