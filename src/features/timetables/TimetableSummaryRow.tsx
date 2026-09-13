import { Pressable, StyleSheet, Text, View } from "react-native";

import { useI18n } from "@/i18n/I18nProvider";
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
  /**
   * A long press on the row, when the screen offers contextual actions for it.
   *
   * Optional, and absent on the screens that do not — Settings shows the
   * current timetable as a way in and has nothing to offer about it. Where it
   * is given, a normal tap still does exactly what it did: the long press adds
   * a shortcut and takes nothing away, which is the only way a hidden gesture
   * is acceptable.
   */
  onLongPress?: () => void;
  /**
   * Whether this row is the one the contextual actions are about.
   *
   * Drawn as a tinted background, the same accent wash a selected choice uses
   * elsewhere — enough to be unmistakable while the sheet is up, and not a
   * second kind of highlight for the eye to learn.
   */
  selected?: boolean;
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
  onLongPress,
  selected = false,
  grouped = false,
  last = false,
}: TimetableSummaryRowProps) {
  const { colors, spacing, radii, typography, borderWidth } = useTheme();
  const { t } = useI18n();
  const spoken = [context, name, summary, status].filter(Boolean).join(", ");
  const actionsLabel = t("transfer.selectionActions", { name });

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      /*
       * The long press is a shortcut, so it is announced as one rather than
       * being invisible to a screen reader — which is the difference between a
       * hidden gesture and an undiscoverable feature. Every action it offers is
       * also a button on the timetable's own screen, so nobody depends on it.
       */
      accessibilityActions={onLongPress ? [{ name: "longpress", label: actionsLabel }] : undefined}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "longpress") onLongPress?.();
      }}
      accessibilityState={{ selected }}
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
          backgroundColor: selected ? colors.accentSubtle : pressed ? colors.surfaceMuted : "transparent",
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
