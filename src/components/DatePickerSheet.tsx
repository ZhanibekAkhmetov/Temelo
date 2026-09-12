import { useEffect, useState } from "react";
import { Animated, BackHandler, Easing, Keyboard, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MonthPager } from "@/components/MonthPager";
import { todayIsoDate } from "@/domain/date";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/useTheme";

/** How far below its resting place the sheet starts its entry, in points. */
const ENTRY_OFFSET = 48;
const ENTRY_DURATION_MS = 180;

interface DatePickerSheetProps {
  /** What the date is for — "Start date", "Timetable start". */
  title: string;
  /** The committed value the sheet opens on. ISO date. */
  value: string;
  onCancel: () => void;
  onConfirm: (isoDate: string) => void;
  /** One quiet line under the calendar: what choosing a date will mean. */
  note?: string;
}

/**
 * A focused date picker: a sheet over a dimmed screen, with the whole month
 * grid in view the moment it opens.
 *
 * It replaces a month grid that unfolded inline under its row. In a form
 * that grid opened below the fold, and no amount of scrolling it into view
 * after the fact made it feel like it had answered the tap. A sheet has no
 * fold: it is drawn over whatever the screen is doing, at the bottom where the
 * thumb already is.
 *
 * Render it only while it is open, as the last child of the screen's root —
 * it fills its parent absolutely rather than opening a native `Modal`. That
 * is deliberate. A `Modal` is a separate native window and so sits outside
 * the gesture-handler root, which is how the month pager's swipe was lost
 * once before; drawn in the tree, the sheet stays inside whichever root the
 * screen already has — the app's, or the class editor's own.
 *
 * The chosen date is a draft until Done, so browsing months or tapping a day
 * never commits anything, and Cancel, the scrim and Back all leave the value
 * exactly as it was. The entry is a native-driver fade and slide, so opening
 * it adds no per-frame JavaScript on top of the pager.
 */
export function DatePickerSheet({ title, value, onCancel, onConfirm, note }: DatePickerSheetProps) {
  const { colors, spacing, radii, typography, borderWidth } = useTheme();
  const { t, format } = useI18n();
  const insets = useSafeAreaInsets();

  const [draft, setDraft] = useState(value);
  const [today] = useState(todayIsoDate);
  const [entry] = useState(() => new Animated.Value(0));

  useEffect(() => {
    // The keyboard is the one other thing that would claim the bottom of the
    // screen, and a date is not typed.
    Keyboard.dismiss();
    Animated.timing(entry, {
      toValue: 1,
      duration: ENTRY_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [entry]);

  // On an ordinary screen Back closes the sheet rather than the screen. Inside
  // a native Modal, Back never reaches here — the host has to ask first; see
  // the class editor.
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onCancel();
      return true;
    });
    return () => subscription.remove();
  }, [onCancel]);

  const translateY = entry.interpolate({ inputRange: [0, 1], outputRange: [ENTRY_OFFSET, 0] });

  return (
    <View style={styles.host}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay, opacity: entry }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel={t("common.cancel")}
        />
      </Animated.View>

      <Animated.View
        accessibilityViewIsModal
        style={[
          styles.sheet,
          {
            backgroundColor: colors.surfaceElevated,
            borderColor: colors.divider,
            borderTopWidth: borderWidth.thin,
            borderLeftWidth: borderWidth.thin,
            borderRightWidth: borderWidth.thin,
            borderTopLeftRadius: radii.lg,
            borderTopRightRadius: radii.lg,
            paddingHorizontal: spacing.lg,
            paddingBottom: insets.bottom + spacing.lg,
            opacity: entry,
            transform: [{ translateY }],
          },
        ]}
      >
        {/* The same header as the class editor's: Cancel and Done as full
            44-point targets either side of a title that takes what is left. */}
        <View style={[styles.header, { gap: spacing.sm }]}>
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel={t("common.cancel")}
            hitSlop={8}
            pressRetentionOffset={{ top: 20, bottom: 20, left: 20, right: 20 }}
            style={({ pressed }) => [styles.headerAction, { opacity: pressed ? 0.5 : 1 }]}
          >
            <Text style={[typography.label, { color: colors.textSecondary }]}>{t("common.cancel")}</Text>
          </Pressable>
          <Text style={[typography.subtitle, styles.title, { color: colors.textPrimary }]} numberOfLines={1}>
            {title}
          </Text>
          <Pressable
            onPress={() => onConfirm(draft)}
            accessibilityRole="button"
            accessibilityLabel={t("common.done")}
            hitSlop={8}
            pressRetentionOffset={{ top: 20, bottom: 20, left: 20, right: 20 }}
            style={({ pressed }) => [styles.headerAction, styles.headerActionEnd, { opacity: pressed ? 0.5 : 1 }]}
          >
            <Text style={[typography.label, { color: colors.accentStrong, fontWeight: "700" }]}>{t("common.done")}</Text>
          </Pressable>
        </View>

        {/* The draft, in words, so the choice is readable before it is made. */}
        <Text
          style={[typography.body, styles.selected, { color: colors.accentStrong, marginBottom: spacing.xs }]}
          accessibilityLiveRegion="polite"
        >
          {format.dateLong(draft)}
        </Text>

        <MonthPager value={draft} today={today} onSelect={setDraft} />

        {note ? (
          <Text style={[typography.caption, { color: colors.textMuted, marginTop: spacing.sm }]}>{note}</Text>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: "flex-end",
    zIndex: 10,
    elevation: 10,
  },
  sheet: {
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 52,
  },
  headerAction: {
    minHeight: 44,
    minWidth: 64,
    justifyContent: "center",
  },
  headerActionEnd: {
    alignItems: "flex-end",
  },
  title: {
    flex: 1,
    textAlign: "center",
  },
  selected: {
    textAlign: "center",
    fontWeight: "600",
  },
});
