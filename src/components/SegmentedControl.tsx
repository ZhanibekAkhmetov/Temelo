import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/theme/useTheme";

interface SegmentedControlOption<T extends string> {
  label: string;
  value: T;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: SegmentedControlProps<T>) {
  const { colors, spacing, radii, typography, borderWidth } = useTheme();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.container,
        { borderColor: colors.border, borderWidth: borderWidth.thin, borderRadius: radii.sm },
      ]}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            style={[
              styles.segment,
              {
                backgroundColor: selected ? colors.accentMuted : "transparent",
                paddingVertical: spacing.sm,
                borderLeftWidth: index === 0 ? 0 : borderWidth.thin,
                borderLeftColor: colors.border,
              },
            ]}
          >
            <Text
              style={[
                typography.label,
                { color: selected ? colors.accent : colors.textSecondary, textAlign: "center" },
              ]}
              numberOfLines={1}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    overflow: "hidden",
  },
  segment: {
    flex: 1,
    minHeight: 40,
    justifyContent: "center",
  },
});
