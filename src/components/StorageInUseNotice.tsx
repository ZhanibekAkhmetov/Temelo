import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/useTheme";
import { reloadApp } from "@/util/storageClaim";

/**
 * What a second browser tab shows instead of the app.
 *
 * The first tab holds the database (see `util/storageClaim.web.ts`), so this
 * one has nothing it could safely show or save. Words, not an error screen:
 * nothing is broken, the timetable is fine and is one tab away. Reloading is
 * the retry — once the other tab is closed, the claim succeeds.
 *
 * Drawn by `BootGate` in place of the navigator, so it paints its own
 * background. Unreachable on a phone.
 */
export function StorageInUseNotice() {
  const { colors, spacing, typography } = useTheme();
  const { t } = useI18n();

  return (
    <View style={[styles.container, { backgroundColor: colors.background, padding: spacing.xl, gap: spacing.md }]}>
      <Text style={[typography.title, styles.centered, { color: colors.textPrimary }]}>
        {t("storageInUse.title")}
      </Text>
      <Text
        style={[typography.body, styles.centered, { color: colors.textSecondary, marginBottom: spacing.md }]}
      >
        {t("storageInUse.body")}
      </Text>
      <View style={styles.actions}>
        <Button label={t("storageInUse.reload")} variant="primary" onPress={reloadApp} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  centered: {
    textAlign: "center",
    maxWidth: 420,
  },
  actions: {
    alignSelf: "stretch",
    maxWidth: 320,
    width: "100%",
  },
});
