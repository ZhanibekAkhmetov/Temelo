import { Pressable, StyleSheet, Text, View } from "react-native";

import { FieldRow } from "@/components/FieldRow";
import { useTheme } from "@/theme/useTheme";

interface StepperFieldProps {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  onChange: (value: number) => void;
  helperText?: string;
  /** Announced instead of the bare number, e.g. "8 periods". */
  accessibilityValueText?: string;
}

/**
 * A small whole number, changed a step at a time.
 *
 * This replaces a numeric text input, and the input was the worst interaction
 * in the app. Asking for the number of periods in a day — a number between one
 * and sixteen, which almost nobody ever changes by more than one — opened a
 * full numeric keyboard over the form, hid the preview the field exists to
 * drive, allowed "", "0" and "999" to be typed, and left the screen in an
 * error state until the keyboard was dismissed. Two buttons cannot express any
 * of those, and the answer is always one tap away from the answer before it.
 *
 * The bounds are enforced by the control rather than reported afterwards: at
 * the limit the button is disabled and says so, instead of accepting the tap
 * and returning a validation message.
 */
export function StepperField({
  label,
  value,
  minimum,
  maximum,
  onChange,
  helperText,
  accessibilityValueText,
}: StepperFieldProps) {
  const { colors, spacing, typography } = useTheme();

  return (
    <FieldRow label={label} helperText={helperText}>
      <View style={[styles.group, { gap: spacing.xs }]}>
        <StepButton glyph="−" onPress={() => onChange(value - 1)} disabled={value <= minimum} label={`${label}, −1`} />
        {/* Fixed width and tabular figures, so the row does not shuffle
            sideways as the number goes from one digit to two. */}
        <Text
          accessibilityLabel={accessibilityValueText ?? String(value)}
          style={[typography.body, styles.readout, { color: colors.textPrimary }]}
        >
          {value}
        </Text>
        <StepButton glyph="+" onPress={() => onChange(value + 1)} disabled={value >= maximum} label={`${label}, +1`} />
      </View>
    </FieldRow>
  );
}

function StepButton({
  glyph,
  onPress,
  disabled,
  label,
}: {
  glyph: string;
  onPress: () => void;
  disabled: boolean;
  label: string;
}) {
  const { colors, radii, borderWidth } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
      pressRetentionOffset={{ top: 16, bottom: 16, left: 12, right: 12 }}
      style={({ pressed }) => [
        styles.button,
        {
          borderRadius: radii.sm,
          borderWidth: borderWidth.thin,
          borderColor: colors.dividerStrong,
          backgroundColor: pressed && !disabled ? colors.surfaceMuted : "transparent",
          opacity: disabled ? 0.35 : 1,
        },
      ]}
    >
      <Text style={[styles.glyph, { color: colors.textPrimary }]}>{glyph}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: {
    flexDirection: "row",
    alignItems: "center",
  },
  button: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  readout: {
    minWidth: 32,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  glyph: {
    fontSize: 20,
    lineHeight: 24,
  },
});
