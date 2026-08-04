import { Pressable, StyleSheet, Text } from "react-native";

import { useTheme } from "@/theme/useTheme";

export type ButtonVariant = "primary" | "secondary" | "destructive" | "ghost";

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  accessibilityLabel?: string;
}

export function Button({ label, onPress, variant = "secondary", disabled, accessibilityLabel }: ButtonProps) {
  const { colors, spacing, radii, typography, borderWidth } = useTheme();

  const backgroundColor =
    variant === "primary" ? colors.accent : variant === "destructive" ? colors.destructive : "transparent";
  const textColor = variant === "primary" || variant === "destructive" ? colors.surface : colors.textPrimary;
  const borderColor = variant === "secondary" ? colors.borderStrong : "transparent";

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={6}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor,
          borderColor,
          borderWidth: variant === "secondary" ? borderWidth.thin : 0,
          borderRadius: radii.sm,
          paddingVertical: spacing.sm,
          paddingHorizontal: spacing.lg,
          opacity: disabled ? 0.5 : pressed ? 0.75 : 1,
        },
      ]}
    >
      <Text style={[typography.label, { color: textColor }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 40,
  },
});
