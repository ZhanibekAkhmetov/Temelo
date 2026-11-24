import { useCallback, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { router, useFocusEffect, useNavigation } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { useI18n } from "@/i18n/I18nProvider";
import { useIsDesktop } from "@/theme/useIsDesktop";
import { useTheme } from "@/theme/useTheme";

/**
 * The widest a form screen is drawn on a desktop. A row's label and its value
 * sit at opposite ends of the row, and past this they stop reading as one line.
 */
const DESKTOP_COLUMN_WIDTH = 640;
/** Tall enough that most dialogs never scroll; always clear of the window edge. */
const DESKTOP_DIALOG_MAX_HEIGHT = 760;

interface ScreenContainerProps {
  children: ReactNode;
  scroll?: boolean;
  /**
   * A top app bar, drawn above the content and outside its padding and its
   * scroll — so it keeps its own full-width background and stays put while the
   * page moves under it. See `ScreenHeader`.
   */
  header?: ReactNode;
  /**
   * Desktop only: draw the screen as a card floating on the page, the way a
   * setup step is drawn in a desktop app. For the screens that are a whole
   * page there — creating a timetable — rather than a dialog over the week.
   */
  desktopCard?: boolean;
  /**
   * Desktop only: draw the screen as a dialog over the one beneath it — a
   * backdrop that closes it, and a card in the middle. The route must also be
   * presented as one (`useDesktopDialogOptions` in the root layout), which is
   * what keeps the screen beneath drawn.
   */
  desktopDialog?: boolean;
}

export function ScreenContainer({
  children,
  scroll = true,
  header,
  desktopCard = false,
  desktopDialog = false,
}: ScreenContainerProps) {
  const { colors, spacing, radii, borderWidth } = useTheme();
  const { t } = useI18n();
  const isDesktop = useIsDesktop();
  // The screen's own navigator, not the global router: during this render the
  // router has not caught up with the push that is rendering it.
  const navigation = useNavigation();
  /*
   * A dialog needs something to be a dialog *over*. Opened from inside the
   * app there always is; a page loaded straight from its address has nothing
   * beneath it, and is drawn as an ordinary page instead of a card floating on
   * an empty window.
   */
  const asDialog = isDesktop && desktopDialog && navigation.canGoBack();

  // Escape closes the dialog on top — only that one: a dialog underneath
  // another is not focused, and so is not listening.
  useFocusEffect(
    useCallback(() => {
      if (!asDialog || typeof window === "undefined") return undefined;
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape" && !event.defaultPrevented) router.back();
      };
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }, [asDialog]),
  );

  const padding = isDesktop ? spacing.xl : spacing.lg;
  const content = scroll ? (
    <ScrollView contentContainerStyle={{ padding, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={{ flex: 1, padding }}>{children}</View>
  );

  const body = (
    <>
      {header}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {content}
      </KeyboardAvoidingView>
    </>
  );

  if (!isDesktop) {
    return (
      <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} edges={["top", "left", "right", "bottom"]}>
        {body}
      </SafeAreaView>
    );
  }

  const cardFrame = {
    borderRadius: radii.lg * 1.4,
    borderWidth: borderWidth.thin,
    borderColor: colors.divider,
    overflow: "hidden" as const,
    shadowColor: colors.shadow,
    shadowOpacity: 0.25,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 12 },
  };

  if (asDialog) {
    return (
      <View style={[styles.flex, styles.dialogRoot, { padding: spacing.xl }]}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
        />
        {/* As tall as its content and no taller, up to the cap; past it the
            content scrolls under the header. A short screen is a short
            dialog, not a tall card with four rows at the top. */}
        <View
          accessibilityViewIsModal
          style={[styles.desktopColumn, styles.dialogCard, { backgroundColor: colors.background }, cardFrame]}
        >
          {header}
          <ScrollView
            style={styles.dialogScroll}
            contentContainerStyle={{ padding }}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        </View>
      </View>
    );
  }

  /*
   * Desktop page. A column, never the full width of the window: a
   * 2,000-pixel-wide text field or button is a stretched phone screen, not a
   * desktop form.
   */
  return (
    <View
      style={[
        styles.flex,
        styles.desktopPage,
        { backgroundColor: desktopCard ? colors.surfaceMuted : colors.background },
        desktopCard && { paddingVertical: spacing.xxl, paddingHorizontal: spacing.xl },
      ]}
    >
      <View style={[styles.flex, styles.desktopColumn, { backgroundColor: colors.background }, desktopCard && cardFrame]}>
        {body}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  desktopPage: {
    alignItems: "center",
  },
  desktopColumn: {
    width: "100%",
    maxWidth: DESKTOP_COLUMN_WIDTH,
  },
  dialogRoot: {
    alignItems: "center",
    justifyContent: "center",
  },
  dialogCard: {
    maxHeight: DESKTOP_DIALOG_MAX_HEIGHT,
    flexShrink: 1,
  },
  dialogScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
});
