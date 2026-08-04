import { StyleSheet, Switch, Text, View } from "react-native";

import { useTheme } from "@/theme/useTheme";

interface SwitchRowProps {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}

export function SwitchRow({ label, description, value, onValueChange }: SwitchRowProps) {
  const { colors, spacing, typography } = useTheme();

  return (
    <View style={[styles.row, { paddingVertical: spacing.sm }]}>
      <View style={styles.text}>
        <Text style={[typography.body, { color: colors.textPrimary }]}>{label}</Text>
        {description ? (
          <Text style={[typography.caption, { color: colors.textMuted, marginTop: 2 }]}>{description}</Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        accessibilityLabel={label}
        accessibilityRole="switch"
        trackColor={{ true: colors.accent, false: colors.border }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  text: {
    flex: 1,
  },
});
