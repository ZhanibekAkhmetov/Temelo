import { useEffect, useState, type ReactNode } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/theme/useTheme";

interface CollapsibleFieldProps {
  label: string;
  /** The collapsed state: just the current value, as in the reference design. */
  valueText: string;
  expanded: boolean;
  onToggle: () => void;
  /** Fixed height of the panel, so the unfold animates against a known target. */
  panelHeight: number;
  children: ReactNode;
  error?: string;
  helperText?: string;
}

const EXPAND_DURATION_MS = 180;

/**
 * A field that shows only its value until tapped, then unfolds its picker
 * in place. The panel's height is passed in rather than measured: both
 * pickers are fixed-size by construction, and a known target height keeps
 * the unfold from jumping on the first frame the way a measure-then-animate
 * pass does.
 */
export function CollapsibleField({
  label,
  valueText,
  expanded,
  onToggle,
  panelHeight,
  children,
  error,
  helperText,
}: CollapsibleFieldProps) {
  const { colors, spacing, radii, typography, borderWidth } = useTheme();
  const [progress] = useState(() => new Animated.Value(expanded ? 1 : 0));

  useEffect(() => {
    Animated.timing(progress, {
      toValue: expanded ? 1 : 0,
      duration: EXPAND_DURATION_MS,
      easing: expanded ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [expanded, progress]);

  const height = progress.interpolate({ inputRange: [0, 1], outputRange: [0, panelHeight] });

  return (
    <View style={{ borderBottomWidth: borderWidth.thin, borderColor: colors.border }}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${label}, ${valueText}`}
        style={[styles.row, { paddingVertical: spacing.sm }]}
      >
        <Text style={[typography.label, { color: colors.textSecondary }]}>{label}</Text>
        <View
          style={[
            styles.value,
            {
              backgroundColor: expanded ? colors.surfaceAlt : "transparent",
              borderRadius: radii.lg,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.xs,
            },
          ]}
        >
          <Text style={[typography.body, { color: expanded ? colors.accent : colors.textPrimary }]}>{valueText}</Text>
        </View>
      </Pressable>

      <Animated.View style={[styles.panel, { height, opacity: progress }]}>
        <View style={{ height: panelHeight }}>{children}</View>
      </Animated.View>

      {error ? (
        <Text style={[typography.caption, { color: colors.destructive, paddingBottom: spacing.xs }]}>{error}</Text>
      ) : helperText ? (
        <Text style={[typography.caption, { color: colors.textMuted, paddingBottom: spacing.xs }]}>{helperText}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: 48,
  },
  value: {
    alignItems: "flex-end",
  },
  panel: {
    overflow: "hidden",
  },
});
