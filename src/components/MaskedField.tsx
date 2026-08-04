import { StyleSheet, Text, TextInput, View } from "react-native";

import { useTheme } from "@/theme/useTheme";

interface MaskedFieldProps {
  label: string;
  /** Already-formatted text the user has typed so far, e.g. "04." or "07:". */
  typedPrefix: string;
  /** Full-length static pattern, e.g. "DD.MM.YYYY" or "HH:mm" — must be the
   *  same length as a fully-typed `typedPrefix`, separators included. */
  fullMask: string;
  onChangeRawText: (rawText: string) => void;
  maxLength: number;
  error?: string;
  helperText?: string;
}

/**
 * Shared rendering for TimeInput/DateInput: the real TextInput is kept but
 * rendered with transparent text (only its caret is visible), and a Text
 * overlay on top draws the typed portion in normal color plus the
 * not-yet-typed portion of the mask in a dimmed color — so the pattern
 * stays visible the whole time you're filling it in, not just before you
 * start typing. RN's TextInput can't mix two text colors in one string,
 * hence the overlay.
 */
export function MaskedField({ label, typedPrefix, fullMask, onChangeRawText, maxLength, error, helperText }: MaskedFieldProps) {
  const { colors, spacing, radii, typography, borderWidth } = useTheme();
  const remainder = fullMask.slice(typedPrefix.length);

  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.xs }]}>{label}</Text>
      <View
        style={[
          styles.wrapper,
          {
            borderColor: error ? colors.destructive : colors.border,
            borderWidth: borderWidth.thin,
            borderRadius: radii.sm,
            backgroundColor: colors.surface,
          },
        ]}
      >
        <TextInput
          value={typedPrefix}
          onChangeText={onChangeRawText}
          keyboardType="number-pad"
          maxLength={maxLength}
          accessibilityLabel={label}
          cursorColor={colors.accent}
          selectionColor={colors.accent}
          underlineColorAndroid="transparent"
          style={[
            typography.body,
            styles.input,
            { color: "transparent", paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, includeFontPadding: false },
          ]}
        />
        <View style={[styles.overlay, { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm }]} pointerEvents="none">
          <Text style={[typography.body, styles.overlayText]} numberOfLines={1}>
            <Text style={{ color: colors.textPrimary }}>{typedPrefix}</Text>
            <Text style={{ color: colors.textMuted }}>{remainder}</Text>
          </Text>
        </View>
      </View>
      {error ? (
        <Text style={[typography.caption, { color: colors.destructive, marginTop: spacing.xs }]}>{error}</Text>
      ) : helperText ? (
        <Text style={[typography.caption, { color: colors.textMuted, marginTop: spacing.xs }]}>{helperText}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "relative",
    justifyContent: "center",
  },
  input: {
    minHeight: 40,
  },
  overlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  overlayText: {
    includeFontPadding: false,
  },
});
