import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/useTheme";

interface ConfirmDialogProps {
  /** The question, naming the thing it is about — "Restore SoSe26?". */
  title: string;
  /** What will happen, in a sentence or two. Line breaks are kept. */
  message: string;
  /** The verb that does it — "Restore", "Archive", "Delete". */
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /**
   * An action that cannot be taken back. Drawn in the danger colour, and a tap
   * on the dimmed screen around it does *not* dismiss it: the one confirmation
   * that must never be answered by accident is the one that deletes.
   */
  destructive?: boolean;
}

/**
 * Temelo's own confirmation, for the decisions that replace or remove a whole
 * timetable.
 *
 * It replaces the platform `Alert`, which on Android is a grey system dialog
 * with teal buttons that looks like it belongs to a different app — at the one
 * moment the user most needs to trust this one. This is the same surface the
 * sheets use: elevated card, restrained scrim, the app's type and colour.
 *
 * Render it only while it is open. It is a native `Modal`, deliberately — it
 * holds no gestures, so the gesture-handler root that rules out a Modal for the
 * date sheet does not apply, and a Modal is what puts it above headers and
 * receives Android Back through `onRequestClose`. Back always cancels, for
 * every tone: it is how a user gets out of anything.
 *
 * Both buttons share the row equally and are full 44-point targets. The action
 * is the filled one on the right, where the thumb ends up; Cancel is outlined
 * beside it so the two can never be mistaken for each other.
 */
export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel, destructive = false }: ConfirmDialogProps) {
  const { colors, spacing, radii, typography, borderWidth } = useTheme();
  const { t } = useI18n();
  // A second tap in the frame before the dialog closes would run the action
  // twice — two restores, two archives.
  const [committing, setCommitting] = useState(false);

  function confirm() {
    if (committing) return;
    setCommitting(true);
    onConfirm();
  }

  function cancel() {
    if (committing) return;
    onCancel();
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={cancel} statusBarTranslucent>
      <View style={[styles.root, { padding: spacing.xl }]}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
          onPress={destructive ? undefined : cancel}
          // Announced only when it does something; a scrim that ignores taps
          // should not be offered to a screen reader as a button.
          accessible={!destructive}
          accessibilityRole="button"
          accessibilityLabel={t("common.cancel")}
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
            },
          ]}
        >
          <Text accessibilityRole="header" style={[typography.title, styles.title, { color: colors.textPrimary }]}>
            {title}
          </Text>
          <Text style={[typography.body, styles.message, { color: colors.textSecondary, marginTop: spacing.sm }]}>
            {message}
          </Text>

          <View style={[styles.actions, { marginTop: spacing.xl, gap: spacing.sm }]}>
            <View style={styles.action}>
              <Button label={t("common.cancel")} variant="secondary" onPress={cancel} disabled={committing} />
            </View>
            <View style={styles.action}>
              <Button
                label={confirmLabel}
                variant={destructive ? "destructive" : "primary"}
                onPress={confirm}
                disabled={committing}
              />
            </View>
          </View>
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
    elevation: 8,
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  // A little larger than a section title and one step lighter than a screen
  // title: it is a question, and it should read as one at a glance.
  title: {
    fontSize: 18,
  },
  message: {
    lineHeight: 21,
  },
  actions: {
    flexDirection: "row",
  },
  action: {
    flex: 1,
  },
});
