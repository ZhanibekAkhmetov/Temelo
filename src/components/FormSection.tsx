import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

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

interface ListRowProps {
  /** The thing itself — a timetable's name. Primary, and the whole point. */
  title: string;
  /** One quiet line about it: "Mon–Fri · 07:30–15:10", "Archived 11 Sep". */
  subtitle?: string;
  onPress: () => void;
  accessibilityLabel?: string;
  /** The last row of a group, where the group's own edge is the separator. */
  last?: boolean;
}

/**
 * A row that *is* a thing, rather than a setting with a value.
 *
 * `NavigationRow` answers "what is this set to" — a label on the left, its
 * current value on the right. That is the wrong shape for a timetable: the name
 * is not the value of anything, it is the subject of the row, and squeezing it
 * into the right-hand value column made the most important row in Settings read
 * as the least important one on the page.
 *
 * So the title takes the line, at body weight and full width, with the summary
 * under it in caption grey and a chevron pinned right. Same hairline, same
 * height band, same full-row target as every other row in the app — the list
 * language is unchanged; only which half of the row carries the meaning is.
 *
 * Deliberately not a card. A card would say "this is a different kind of
 * object"; it is a list item, and there may be several.
 */
export function ListRow({ title, subtitle, onPress, accessibilityLabel, last = false }: ListRowProps) {
  const { colors, spacing, typography, borderWidth } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (subtitle ? `${title}, ${subtitle}` : title)}
      // The same tolerance every row in the app has: a finger that drifts a few
      // points while pressing has not changed its mind, and the neighbours are
      // other rows rather than empty space.
      pressRetentionOffset={{ top: 12, bottom: 12, left: 16, right: 16 }}
      style={({ pressed }) => [
        styles.listRow,
        {
          paddingVertical: spacing.sm,
          gap: spacing.md,
          borderBottomWidth: last ? 0 : borderWidth.thin,
          borderColor: colors.divider,
          backgroundColor: pressed ? colors.surfaceMuted : "transparent",
        },
      ]}
    >
      <View style={styles.listRowText}>
        <Text style={[typography.body, { color: colors.textPrimary }]} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[typography.caption, { color: colors.textMuted, marginTop: 2 }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Text style={[typography.body, { color: colors.textMuted }]}>›</Text>
    </Pressable>
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
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    // Two lines of text plus padding lands in the 52–56 band; the floor is
    // what keeps a row with no subtitle the same size as one with.
    minHeight: 52,
  },
  listRowText: {
    flexShrink: 1,
    flexGrow: 1,
  },
});
