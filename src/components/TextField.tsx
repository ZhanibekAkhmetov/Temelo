import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";

import { useTheme } from "@/theme/useTheme";

interface TextFieldProps extends Pick<
  TextInputProps,
  "value" | "onChangeText" | "placeholder" | "keyboardType" | "autoFocus" | "multiline" | "autoCapitalize" | "onSubmitEditing" | "returnKeyType"
> {
  label: string;
  error?: string;
  helperText?: string;
}

export function TextField({ label, error, helperText, ...inputProps }: TextFieldProps) {
  const { colors, spacing, radii, typography, borderWidth } = useTheme();

  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.xs }]}>{label}</Text>
      <TextInput
        {...inputProps}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={label}
        style={[
          typography.body,
          styles.input,
          {
            color: colors.textPrimary,
            borderColor: error ? colors.destructive : colors.border,
            borderWidth: borderWidth.thin,
            borderRadius: radii.sm,
            backgroundColor: colors.surface,
            paddingHorizontal: spacing.sm,
            paddingVertical: spacing.sm,
          },
          inputProps.multiline ? styles.multiline : null,
        ]}
      />
      {error ? (
        <Text style={[typography.caption, { color: colors.destructive, marginTop: spacing.xs }]}>{error}</Text>
      ) : helperText ? (
        <Text style={[typography.caption, { color: colors.textMuted, marginTop: spacing.xs }]}>{helperText}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 40,
  },
  multiline: {
    minHeight: 72,
    textAlignVertical: "top",
  },
});
