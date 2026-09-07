import { Pressable, StyleSheet, Text } from "react-native";

import { useTheme } from "@/theme/useTheme";

interface ChoiceRowProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

/**
 * One option in a picker's list.
 *
 * Extracted from the reminder picker so the language picker is visibly the
 * same kind of thing rather than a second design for the same job. The tick
 * carries the selection as well as the colour does, which is what keeps it
 * readable for anyone who cannot tell the accent from the body text.
 *
 * Two lines, left-aligned, with the tick pinned to the right: "Systemeinstellung"
 * and "Раз в 2 недели" have to wrap somewhere, and wrapping under the label
 * rather than under the tick is what keeps the column of ticks straight.
 */
export function ChoiceRow({ label, selected, onPress }: ChoiceRowProps) {
  const { colors, spacing, radii, typography } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      pressRetentionOffset={{ top: 12, bottom: 12, left: 16, right: 16 }}
      style={({ pressed }) => [
        styles.choice,
        {
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          borderRadius: radii.sm,
          backgroundColor: selected || pressed ? colors.surfaceMuted : "transparent",
          opacity: pressed && !selected ? 0.8 : 1,
        },
      ]}
    >
      <Text style={[typography.body, styles.label, { color: selected ? colors.accentStrong : colors.textPrimary }]}>
        {label}
      </Text>
      {selected ? <Text style={[typography.body, { color: colors.accentStrong }]}>✓</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  choice: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: 44,
  },
  label: {
    flexShrink: 1,
  },
});
