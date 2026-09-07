import { StyleSheet, Switch, Text, View } from "react-native";

import { useTheme } from "@/theme/useTheme";

interface SwitchRowProps {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}

export function SwitchRow({ label, description, value, onValueChange }: SwitchRowProps) {
  const { colors, spacing, typography, borderWidth } = useTheme();

  return (
    <View
      style={[
        styles.row,
        { paddingVertical: spacing.sm, borderBottomWidth: borderWidth.thin, borderColor: colors.divider },
      ]}
    >
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
        trackColor={{ true: colors.accent, false: colors.dividerStrong }}
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
    // The same row height as every other setting, so a list of them does not
    // step up and down depending on which control each one carries.
    minHeight: 48,
  },
  text: {
    flex: 1,
  },
});
