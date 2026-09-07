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
    variant === "primary" ? colors.accent : variant === "destructive" ? colors.danger : "transparent";
  // Not "whatever the surface is": on a dark scheme the accent is a light
  // blue and needs dark text on it, which is exactly what these two tokens
  // are for.
  const textColor =
    variant === "primary" ? colors.textOnAccent : variant === "destructive" ? colors.textOnDanger : colors.textPrimary;
  const borderColor = variant === "secondary" ? colors.dividerStrong : "transparent";

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={6}
      // A press is a decision, and a finger that shifts a few points while
      // making it has not changed its mind. Without this a Save that was
      // visibly held down could still do nothing, which is the single most
      // confidence-destroying thing a button can do.
      pressRetentionOffset={{ top: 16, bottom: 16, left: 16, right: 16 }}
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
      {/* Two lines rather than one, and centred: German and Russian button
          text runs half again as long as English, and a clipped "Änderungen
          speichern" is worse than a button one line taller. */}
      <Text style={[typography.label, styles.label, { color: textColor }]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
    // The platform minimum for a target anyone has to hit reliably.
    minHeight: 44,
  },
  label: {
    textAlign: "center",
  },
});
