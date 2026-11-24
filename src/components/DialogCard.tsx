import type { ReactNode } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";

import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/useTheme";

interface DialogCardProps {
  children: ReactNode;
  /**
   * What Android Back and a tap on the dimmed screen do. Omitted while
   * something is in progress that leaving would not stop.
   */
  onRequestClose?: () => void;
}

/**
 * A centred card over a dimmed screen — the surface `ImportPreviewDialog` and
 * `ConfirmDialog` draw — for a dialog whose content is its own.
 *
 * The same on a phone and a desktop: a centred card is already the desktop's
 * shape, and on a phone it is the right one for a short exchange that is not a
 * choice from a list (that is what the bottom sheets are for).
 */
export function DialogCard({ children, onRequestClose }: DialogCardProps) {
  const { colors, spacing, radii, borderWidth } = useTheme();
  const { t } = useI18n();

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onRequestClose ?? (() => {})} statusBarTranslucent>
      <View style={[styles.root, { padding: spacing.xl }]}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
          onPress={onRequestClose}
          disabled={!onRequestClose}
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
              borderRadius: radii.lg,
              padding: spacing.lg,
              shadowColor: colors.shadow,
              gap: spacing.md,
            },
          ]}
        >
          {children}
        </View>
      </View>
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
    maxWidth: 420,
    maxHeight: "85%",
    elevation: 8,
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
});
