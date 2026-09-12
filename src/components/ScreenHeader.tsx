import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/theme/useTheme";

interface ScreenHeaderProps {
  title: string;
  /** Omitted on a screen that cannot be left this way. */
  onBack?: () => void;
  accessibilityBackLabel: string;
  /** A trailing action — "Save", "Done". At most one. */
  action?: { label: string; onPress: () => void; emphasis?: boolean; disabled?: boolean };
}

/**
 * A back chevron, a title, and at most one trailing action.
 *
 * A separate component because there are now several pushed screens rather
 * than the one Settings modal, and each had been growing its own header row.
 * Three of them side by side is three subtly different title sizes and three
 * ideas of how big a back target is.
 *
 * The title is centred between the two edges and takes what is left, so a long
 * localised name ("Archivierte Stundenpläne") shortens rather than pushing the
 * action off the row. Both touch targets are a full 44 points with generous
 * press retention — the same rule the class editor's header follows, for the
 * same reason: a header press that is missed is a press the user has to think
 * about.
 *
 * The one placement rule for every pushed screen: Back at the leading edge,
 * the action at the trailing edge, and neither ever moves with the screen's
 * state. A control that is absent leaves its empty 44-point slot behind, so
 * the title and the other control stay exactly where they were. (Modal
 * editors and sheets follow the same sides with Cancel and Save/Done.)
 */
export function ScreenHeader({ title, onBack, accessibilityBackLabel, action }: ScreenHeaderProps) {
  const { colors, spacing, typography, borderWidth } = useTheme();

  return (
    <View
      style={[
        styles.row,
        {
          paddingHorizontal: spacing.sm,
          backgroundColor: colors.headerBackground,
          borderBottomWidth: borderWidth.thin,
          borderColor: colors.divider,
        },
      ]}
    >
      {onBack ? (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={accessibilityBackLabel}
          hitSlop={8}
          pressRetentionOffset={{ top: 20, bottom: 20, left: 20, right: 20 }}
          style={({ pressed }) => [styles.target, { opacity: pressed ? 0.5 : 1 }]}
        >
          <Text style={[styles.chevron, { color: colors.accentStrong }]}>‹</Text>
        </Pressable>
      ) : (
        <View style={styles.target} />
      )}

      <Text style={[typography.subtitle, styles.title, { color: colors.textPrimary }]} numberOfLines={1}>
        {title}
      </Text>

      {action ? (
        <Pressable
          onPress={action.onPress}
          disabled={action.disabled}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          accessibilityState={{ disabled: Boolean(action.disabled) }}
          hitSlop={8}
          pressRetentionOffset={{ top: 20, bottom: 20, left: 20, right: 20 }}
          style={({ pressed }) => [
            styles.target,
            styles.actionTarget,
            { opacity: action.disabled ? 0.4 : pressed ? 0.5 : 1 },
          ]}
        >
          <Text
            style={[
              typography.label,
              { color: colors.accentStrong, fontWeight: action.emphasis ? "700" : "500" },
            ]}
            numberOfLines={1}
          >
            {action.label}
          </Text>
        </Pressable>
      ) : (
        <View style={styles.target} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  title: {
    flex: 1,
    textAlign: "center",
  },
  target: {
    minWidth: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  actionTarget: {
    alignItems: "flex-end",
    paddingRight: 4,
  },
  chevron: {
    fontSize: 26,
    lineHeight: 28,
  },
});
