import type { ReactNode } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/useTheme";

const TOOLBAR_HEIGHT = 64;

interface DesktopToolbarProps {
  /** "November 2026" — the month the visible week belongs to. */
  title: string;
  onToggleSidebar: () => void;
  /** Null when there is no week to move through: no timetable yet. */
  navigation: {
    onToday: () => void;
    onPrevious: () => void;
    onNext: () => void;
  } | null;
}

/**
 * The desktop's top bar, in the order a desktop calendar's is read: the menu
 * that shows and hides the sidebar, the app, then Today and the week arrows
 * beside the month they lead through.
 *
 * Today is always offered here, not only away from the current week as on the
 * phone. On a phone it competes with the month title for a few points of
 * header; on a desktop it is a fixed landmark, and a button that appears and
 * disappears moves everything beside it.
 */
export function DesktopToolbar({ title, onToggleSidebar, navigation }: DesktopToolbarProps) {
  const { colors, spacing, typography, borderWidth } = useTheme();
  const { t } = useI18n();

  return (
    <View
      style={[
        styles.bar,
        {
          paddingHorizontal: spacing.md,
          gap: spacing.sm,
          backgroundColor: colors.headerBackground,
          borderBottomWidth: borderWidth.thin,
          borderColor: colors.divider,
        },
      ]}
    >
      <RoundButton label={t("desktop.toggleSidebar")} onPress={onToggleSidebar}>
        <Text style={[styles.glyph, { color: colors.textSecondary }]}>≡</Text>
      </RoundButton>

      <View style={[styles.brand, { marginRight: spacing.xl }]}>
        <Image source={require("@/assets/branding/icon.png")} style={styles.logo} accessibilityIgnoresInvertColors />
        <Text style={[styles.brandName, { color: colors.textPrimary }]}>Temelo</Text>
      </View>

      {navigation ? (
        <>
          <Pressable
            onPress={navigation.onToday}
            accessibilityRole="button"
            accessibilityLabel={t("timetable.goToCurrentWeek")}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.todayButton,
              {
                borderColor: colors.dividerStrong,
                borderWidth: borderWidth.thin,
                backgroundColor: hovered ? colors.surfaceMuted : "transparent",
                opacity: pressed ? 0.7 : 1,
                marginRight: spacing.sm,
              },
            ]}
          >
            <Text style={[typography.label, { color: colors.textPrimary }]}>{t("timetable.today")}</Text>
          </Pressable>
          <RoundButton label={t("timetable.previousWeek")} onPress={navigation.onPrevious}>
            <Text style={[styles.glyph, { color: colors.textSecondary }]}>‹</Text>
          </RoundButton>
          <RoundButton label={t("timetable.nextWeek")} onPress={navigation.onNext}>
            <Text style={[styles.glyph, { color: colors.textSecondary }]}>›</Text>
          </RoundButton>
          <Text
            style={[styles.title, { color: colors.textPrimary, marginLeft: spacing.sm }]}
            numberOfLines={1}
            accessibilityRole="header"
          >
            {title}
          </Text>
        </>
      ) : null}
    </View>
  );
}

function RoundButton({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.round,
        { backgroundColor: hovered ? colors.surfaceMuted : "transparent", opacity: pressed ? 0.6 : 1 },
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: TOOLBAR_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  logo: {
    width: 32,
    height: 32,
    borderRadius: 8,
  },
  brandName: {
    fontSize: 20,
    fontWeight: "500",
  },
  todayButton: {
    height: 36,
    paddingHorizontal: 18,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  round: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  glyph: {
    fontSize: 22,
    lineHeight: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: "400",
    flexShrink: 1,
  },
});
