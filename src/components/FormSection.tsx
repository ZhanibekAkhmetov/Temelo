import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { FieldRow, FieldValue } from "@/components/FieldRow";
import { useTheme } from "@/theme/useTheme";

interface FormSectionProps {
  /** Omitted for the first group, which sits directly under the screen title. */
  title?: string;
  children: ReactNode;
}

/**
 * One group of form rows, under a quiet heading.
 *
 * The whole of the layout is: a small upper-case heading, then rows that each
 * draw their own hairline underneath. No card, no border around the group, no
 * elevation — a form is a list of things you can change, and every box drawn
 * around part of it is one more edge competing with the values the eye is
 * actually looking for.
 *
 * The heading is `textMuted` and letterspaced rather than large and bold: it
 * has to be findable when scanning down the page and invisible when reading a
 * row, which is the opposite weighting from a title.
 *
 * Used by every form in the app, not only Settings — the academic-day editor
 * and the class editor are the same kind of surface and had drifted into three
 * different answers to the same question.
 */
export function FormSection({ title, children }: FormSectionProps) {
  const { colors, spacing, typography } = useTheme();

  return (
    <View style={{ marginTop: title ? spacing.xl : spacing.lg }}>
      {title ? (
        <Text
          style={[
            typography.caption,
            styles.heading,
            { color: colors.textMuted, marginBottom: spacing.xs },
          ]}
        >
          {title.toUpperCase()}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

interface NavigationRowProps {
  label: string;
  /** The current value, so the row answers its own question without opening. */
  value?: string;
  onPress: () => void;
}

/**
 * A row that opens a screen of its own — the academic-day editor, the term.
 *
 * The same `FieldRow` as everything else, with a chevron after the value to
 * say that tapping it leaves this screen rather than unfolding in place. That
 * distinction is the row's whole job, so it is the only thing that
 * distinguishes it.
 */
export function NavigationRow({ label, value, onPress }: NavigationRowProps) {
  const { colors, spacing, typography } = useTheme();

  return (
    <FieldRow label={label} onPress={onPress} accessibilityLabel={value ? `${label}, ${value}` : label}>
      <View style={[styles.trailing, { gap: spacing.xs }]}>
        {value ? <FieldValue>{value}</FieldValue> : null}
        <Text style={[typography.body, { color: colors.textMuted }]}>›</Text>
      </View>
    </FieldRow>
  );
}

const styles = StyleSheet.create({
  heading: {
    letterSpacing: 0.8,
    fontWeight: "600",
  },
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
  },
});
