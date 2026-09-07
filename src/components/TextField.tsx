import { StyleSheet, TextInput, type TextInputProps } from "react-native";

import { FieldRow } from "@/components/FieldRow";
import { useTheme } from "@/theme/useTheme";

interface TextFieldProps extends Pick<
  TextInputProps,
  "value" | "onChangeText" | "placeholder" | "keyboardType" | "autoFocus" | "multiline" | "autoCapitalize" | "onSubmitEditing" | "returnKeyType"
> {
  label: string;
  error?: string;
  helperText?: string;
}

/**
 * Text, as a field row.
 *
 * It used to be the odd one out: a caption above a bordered, filled box, while
 * every other field in the app was a label with its value on the right. Two
 * of them next to each other — a class name above a reminder — looked like two
 * screens spliced together. So the box is gone and the input sits where a value
 * sits, right-aligned in the same column as every date, duration and choice on
 * the screen.
 *
 * There is no border and no fill because the row already has an edge: the
 * hairline underneath it. An input drawn as a box *inside* a row that already
 * has a box is the visual noise this was meant to remove, and a caret plus a
 * placeholder is enough to say a field is editable.
 *
 * Notes are the exception and stack, because a multi-line value cannot share a
 * line with its label without either wrapping under the label or squeezing it.
 */
export function TextField({ label, error, helperText, ...inputProps }: TextFieldProps) {
  const { colors, spacing, typography, radii } = useTheme();
  const multiline = Boolean(inputProps.multiline);

  return (
    <FieldRow label={label} stacked={multiline} error={error} helperText={helperText}>
      <TextInput
        {...inputProps}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={label}
        style={[
          typography.body,
          multiline ? styles.multiline : styles.input,
          {
            color: colors.textPrimary,
            // Only a note gets a ground of its own: it is a block of text
            // rather than a value, and needs an edge to say where it ends.
            backgroundColor: multiline ? colors.inputBackground : "transparent",
            borderRadius: multiline ? radii.sm : 0,
            paddingHorizontal: multiline ? spacing.sm : 0,
            paddingVertical: multiline ? spacing.sm : 0,
          },
        ]}
      />
    </FieldRow>
  );
}

const styles = StyleSheet.create({
  input: {
    // Fills the value column and writes towards the right edge, so the text
    // lines up with the values of the rows above and below it.
    width: "100%",
    textAlign: "right",
    // The row supplies the height, so the input adds none of its own — but it
    // still needs room for its own descenders, which Android will otherwise
    // clip against a zeroed padding box.
    padding: 0,
    minHeight: 24,
  },
  multiline: {
    minHeight: 76,
    textAlignVertical: "top",
  },
});
