import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/theme/useTheme";

interface TimetableSummaryRowProps {
  /** The timetable's name — the subject of the row. */
  name: string;
  /** One quiet line about it: "Mon–Fri · 07:30–21:50". */
  summary?: string;
  /**
   * What the row *is*, above the name, when the surrounding screen does not
   * already say it — "Current timetable" in Settings. The Timetables screen
   * has a section heading doing that job and leaves this out.
   */
  context?: string;
  /** A subtle status beside the chevron — "Current". */
  status?: string;
  onPress: () => void;
  /** Drawn inside a `ListGroup`, so inset from the group's edges. */
  grouped?: boolean;
  /** The last row of a group, where the group's own edge is the separator. */
  last?: boolean;
}

/**
 * One timetable, as a row you open.
 *
 * Settings and the Timetables screen both describe the same timetable, and
 * they used to do it in two visual languages — a plain body-weight line in
 * one, a bold title with an accent status line in the other. They have
 * different jobs, but the timetable itself should look like the same object in
 * both. So this is the one presentation of a timetable's identity: its name in
 * semibold body type, the days-and-hours summary under it in caption grey, a
 * chevron because tapping opens it, a 56-point floor so every one is the same
 * target.
 *
 * What differs between the screens comes from around the row, not from the
 * row: in Settings it stands alone in the form with `context` naming it; on
 * the Timetables screen it sits on a grouped surface under a section heading,
 * with `status` marking the current one and nothing marking an archive.
 */
export function TimetableSummaryRow({
  name,
  summary,
  context,
  status,
  onPress,
  grouped = false,
  last = false,
}: TimetableSummaryRowProps) {
  const { colors, spacing, radii, typography, borderWidth } = useTheme();
  const spoken = [context, name, summary, status].filter(Boolean).join(", ");

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      // The same tolerance every row in the app has: a finger that drifts a few
      // points while pressing has not changed its mind.
      pressRetentionOffset={{ top: 12, bottom: 12, left: 16, right: 16 }}
      style={({ pressed }) => [
        styles.row,
        {
          paddingVertical: spacing.md,
          paddingHorizontal: grouped ? spacing.lg : 0,
          gap: spacing.md,
          borderBottomWidth: last ? 0 : borderWidth.thin,
          borderColor: colors.divider,
          backgroundColor: pressed ? colors.surfaceMuted : "transparent",
        },
      ]}
    >
      <View style={styles.text}>
        {context ? (
          <Text style={[typography.caption, { color: colors.textMuted, marginBottom: 2 }]} numberOfLines={1}>
            {context}
          </Text>
        ) : null}
        <Text style={[typography.body, styles.name, { color: colors.textPrimary }]} numberOfLines={2}>
          {name}
        </Text>
        {summary ? (
          <Text style={[typography.caption, { color: colors.textMuted, marginTop: 2 }]} numberOfLines={1}>
            {summary}
          </Text>
        ) : null}
      </View>

      {status ? (
        <Text
          style={[
            typography.caption,
            styles.status,
            {
              color: colors.accentStrong,
              backgroundColor: colors.accentSubtle,
              borderRadius: radii.lg,
              paddingHorizontal: spacing.sm,
            },
          ]}
          numberOfLines={1}
        >
          {status}
        </Text>
      ) : null}
      <Text style={[typography.body, { color: colors.textMuted }]}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    // Two or three lines of text plus padding; the floor keeps a row with no
    // summary the same size as one with.
    minHeight: 56,
  },
  text: {
    flexShrink: 1,
    flexGrow: 1,
  },
  name: {
    fontWeight: "600",
  },
  status: {
    fontWeight: "600",
    paddingVertical: 2,
    overflow: "hidden",
  },
});
