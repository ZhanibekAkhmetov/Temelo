import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";

import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { AboutSection } from "@/features/settings/AboutSection";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppState } from "@/state/AppStateContext";
import { useTheme } from "@/theme/useTheme";

/**
 * About Temelo, as a small dialog over the week — and the one irreversible
 * action the Settings screen holds, deleting everything, which on a desktop
 * has no other home: the sidebar is for choices that can be changed back.
 *
 * It is the last thing in the dialog and asks again before it does anything,
 * with the same wording the Settings screen uses.
 */
export function DesktopAboutDialog({ onClose }: { onClose: () => void }) {
  const { colors, spacing, radii, borderWidth } = useTheme();
  const { t } = useI18n();
  const { deleteAllData } = useAppState();
  const [confirming, setConfirming] = useState(false);

  function confirmReset() {
    setConfirming(false);
    onClose();
    deleteAllData();
    router.replace("/timetables/new-timetable");
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.root, { padding: spacing.xl }]}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.card,
            {
              backgroundColor: colors.surfaceElevated,
              borderColor: colors.divider,
              borderWidth: borderWidth.thin,
              borderRadius: radii.lg * 1.4,
              shadowColor: colors.shadow,
            },
          ]}
        >
          <ScrollView contentContainerStyle={{ padding: spacing.xl }}>
            <AboutSection />
            <View style={[styles.actions, { marginTop: spacing.xl, gap: spacing.sm }]}>
              <Button label={t("settings.reset")} variant="destructive" onPress={() => setConfirming(true)} />
              <Button label={t("common.close")} variant="secondary" onPress={onClose} />
            </View>
          </ScrollView>
        </View>
      </View>

      {confirming ? (
        <ConfirmDialog
          destructive
          title={t("settings.resetTitle")}
          message={t("settings.resetMessage")}
          confirmLabel={t("settings.resetConfirm")}
          onConfirm={confirmReset}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    width: "100%",
    maxWidth: 460,
    maxHeight: "90%",
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
  },
  actions: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
});
