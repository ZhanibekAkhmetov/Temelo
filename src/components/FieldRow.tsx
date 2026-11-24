import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/theme/useTheme";

/** The one row height every field in the app is built on. */
export const FIELD_ROW_MIN_HEIGHT = 48;

interface FieldRowProps {
  label: string;
  /**
   * The right-hand side: a value, an input, a stepper, a colour swatch.
   * Laid out against the right edge, so the values of consecutive rows form a
   * column the eye can run down.
   */
  children: ReactNode;
  /**
   * Put `children` on their own full-width line under the label instead.
   * For the one field that cannot work as a value — a multi-line note.
   */
  stacked?: boolean;
  /** Makes the whole row the touch target. Omit for a row that holds an input. */
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityExpanded?: boolean;
  /** A picker that unfolds beneath the row, inside the same hairline. */
  panel?: ReactNode;
  error?: string;
  helperText?: string;
  /** The last row of a group, where the group's own edge is the separator. */
  last?: boolean;
  /**
   * "select" draws the label above a bordered box holding the value and a
   * chevron — the shape of a desktop drop-down, for a narrow column such as
   * the desktop sidebar where every other control also has its label above
   * it. No divider under it: it is a control in a group, not a row in a list.
   */
  appearance?: "row" | "select";
}

/**
 * One row of a form. Every field in Temelo is one of these.
 *
 * It exists because the app had two field languages and used both on the same
 * screen: text was a captioned box with a border and a background, while
 * everything else — a date, a duration, a reminder, a colour, a choice — was a
 * label on the left and its value on the right, separated by a hairline. Put a
 * class name above a reminder and you get a boxed control sitting on top of a
 * list row, with different heights, different alignments, different weights and
 * two different ideas of where a label goes. That reads as unfinished however
 * carefully either half was made.
 *
 * So there is one shape now, and it is the list row, because it is the one that
 * scales: it stays legible with a long German label, it puts every value in the
 * same column, and it is what a settings screen and a calendar event editor
 * both look like on both platforms. A text field is a row whose value happens
 * to be editable.
 *
 * The hairline belongs to the row rather than to the group, so rows compose
 * without anything having to know how many of them there are — `last` is only
 * for a group that draws its own closing edge.
 */
export function FieldRow({
  label,
  children,
  stacked = false,
  onPress,
  accessibilityLabel,
  accessibilityExpanded,
  panel,
  error,
  helperText,
  last = false,
  appearance = "row",
}: FieldRowProps) {
  const { colors, spacing, typography, borderWidth, radii } = useTheme();

  if (appearance === "select") {
    return (
      <View>
        <Text style={[typography.caption, { color: colors.textSecondary, marginBottom: 6 }]}>{label}</Text>
        <Pressable
          onPress={onPress}
          disabled={!onPress}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel ?? label}
          style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
            styles.select,
            {
              borderWidth: borderWidth.thin,
              borderColor: colors.dividerStrong,
              borderRadius: radii.md,
              paddingHorizontal: spacing.md,
              backgroundColor: hovered ? colors.surfaceMuted : "transparent",
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <View style={styles.selectValue}>{children}</View>
          <Text style={[styles.chevron, { color: colors.textMuted }]}>▾</Text>
        </Pressable>
        {panel}
        {error ? (
          <Text style={[typography.caption, { color: colors.danger, marginTop: 6 }]}>{error}</Text>
        ) : helperText ? (
          <Text style={[typography.caption, { color: colors.textMuted, marginTop: 6 }]}>{helperText}</Text>
        ) : null}
      </View>
    );
  }

  const labelText = (
    <Text style={[typography.label, styles.label, { color: colors.textSecondary }]} numberOfLines={2}>
      {label}
    </Text>
  );

  const body = stacked ? (
    <View style={{ paddingTop: spacing.sm, paddingBottom: spacing.xs }}>
      {labelText}
      <View style={{ marginTop: spacing.xs }}>{children}</View>
    </View>
  ) : (
    <View style={[styles.row, { paddingVertical: spacing.sm, gap: spacing.md }]}>
      {labelText}
      <View style={styles.value}>{children}</View>
    </View>
  );

  return (
    <View style={last ? undefined : { borderBottomWidth: borderWidth.thin, borderColor: colors.divider }}>
      {onPress ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel ?? label}
          accessibilityState={accessibilityExpanded === undefined ? undefined : { expanded: accessibilityExpanded }}
          // A finger that drifts a few points while pressing has not changed
          // its mind. Not `hitSlop`: every neighbour here is another row.
          pressRetentionOffset={{ top: 12, bottom: 12, left: 16, right: 16 }}
          style={({ pressed }) => [pressed ? { backgroundColor: colors.surfaceMuted } : null]}
        >
          {body}
        </Pressable>
      ) : (
        body
      )}

      {panel}

      {error ? (
        <Text style={[typography.caption, { color: colors.danger, paddingBottom: spacing.xs }]}>{error}</Text>
      ) : helperText ? (
        <Text style={[typography.caption, { color: colors.textMuted, paddingBottom: spacing.xs }]}>{helperText}</Text>
      ) : null}
    </View>
  );
}

/**
 * The default right-hand side: the field's current value, as text.
 *
 * Wraps rather than truncating, and shrinks rather than pushing the label off
 * the row — "Systemeinstellung" and "Раз в две недели" are wider than any
 * fixed value column would leave them.
 */
export function FieldValue({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  const { colors, typography } = useTheme();
  return (
    <Text style={[typography.body, styles.valueText, { color: muted ? colors.textMuted : colors.textPrimary }]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: FIELD_ROW_MIN_HEIGHT,
  },
  label: {
    flexShrink: 1,
  },
  value: {
    flexShrink: 1,
    // Never below half the row: a value column that moves about depending on
    // how long each label happens to be is the thing that makes a form look
    // assembled rather than designed.
    flexGrow: 1,
    flexBasis: "45%",
    alignItems: "flex-end",
  },
  valueText: {
    textAlign: "right",
  },
  select: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 36,
  },
  selectValue: {
    flex: 1,
    alignItems: "flex-start",
  },
  chevron: {
    fontSize: 12,
    marginLeft: 8,
  },
});
