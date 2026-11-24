import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/theme/useTheme";

interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}

/**
 * Two or three mutually exclusive choices side by side, each applied the
 * moment it is chosen.
 *
 * Used where every option fits across at once and the choice is worth seeing
 * without opening anything — the desktop sidebar. A phone draws the same
 * settings as a row that opens a list, because three segments do not fit
 * beside a label there.
 */
export function SegmentedControl<T extends string>({ label, value, options, onChange }: SegmentedControlProps<T>) {
  const { colors, radii, typography, borderWidth } = useTheme();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={[
        styles.track,
        { borderColor: colors.dividerStrong, borderWidth: borderWidth.thin, borderRadius: radii.md },
      ]}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            onPress={() => onChange(option.value)}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.segment,
              index > 0 && { borderLeftWidth: borderWidth.thin, borderColor: colors.dividerStrong },
              {
                backgroundColor: selected
                  ? colors.accentSubtle
                  : hovered
                    ? colors.surfaceMuted
                    : "transparent",
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                typography.label,
                { color: selected ? colors.accentStrong : colors.textSecondary, fontWeight: selected ? "600" : "500" },
              ]}
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
  track: {
    flexDirection: "row",
    overflow: "hidden",
  },
  segment: {
    flex: 1,
    minHeight: 34,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
});
