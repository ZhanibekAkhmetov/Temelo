import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/useTheme";

export interface TimetableAction {
  key: string;
  label: string;
  /**
   * One quiet line under the label, for an action whose name is not enough.
   *
   * Added for the two ways a timetable can leave the app, which are genuinely
   * easy to confuse: a Temelo file comes back, a calendar file does not. Every
   * other action here — Delete, and Share when it is the only one — says what
   * it does in its own name and takes none.
   */
  description?: string;
  onPress: () => void;
  /** Drawn in the danger colour. At most one, and always last. */
  destructive?: boolean;
}

interface TimetableActionSheetProps {
  /** The timetable the actions are about. Its name titles the sheet. */
  name: string;
  actions: TimetableAction[];
  onDismiss: () => void;
}

/**
 * What a long press on a timetable row offers.
 *
 * ## Why a sheet and not a row of buttons
 *
 * The Timetables screen deliberately has no permanent Share or Delete on each
 * row: archive, restore and delete are three different decisions with three
 * different consequences, and three small targets within a thumb's width of
 * each other on a list row is how somebody deletes a term's worth of classes by
 * accident. That rule has not changed. What has changed is that a long press
 * now offers the one or two actions that make sense for *that* timetable,
 * exactly the way a long press works everywhere else on Android — and it is a
 * shortcut, not the only route: Share is a button on the timetable's own screen
 * and Delete already was.
 *
 * ## Why not multi-select
 *
 * Android's contextual action bar exists to act on *several* things at once,
 * and nothing here is worth doing to several timetables at once — you do not
 * share two timetables as one file, and deleting several archives in one
 * gesture is a way to lose the wrong one. So the selection is exactly one row,
 * the actions apply to it, and dismissing the sheet ends it. Anything more
 * would be a selection mode the product has no use for.
 *
 * ## The shape
 *
 * The same sheet the app already uses for a choice — `EditScopeSheet`'s
 * surface, spacing and Cancel — because this is the same kind of moment. The
 * timetable's name is the heading, so there is never a question about which row
 * the actions belong to once the sheet has covered it. Every row is a full
 * 56-point target. Cancel is at the bottom, and so are Android Back and a tap
 * on the scrim: three ways out, which is the right number for something a long
 * press can open by accident.
 */
export function TimetableActionSheet({ name, actions, onDismiss }: TimetableActionSheetProps) {
  const { colors, spacing, radii, typography, borderWidth } = useTheme();
  const { t } = useI18n();
  // An action takes a frame or two to open its own sheet or dialog; a second
  // tap in that window would run it twice — two share sheets, two dialogs.
  const [committing, setCommitting] = useState(false);

  function run(action: TimetableAction) {
    if (committing) return;
    setCommitting(true);
    action.onPress();
  }

  function dismiss() {
    if (committing) return;
    onDismiss();
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable
          style={[styles.scrim, { backgroundColor: colors.scrim }]}
          onPress={dismiss}
          accessibilityRole="button"
          accessibilityLabel={t("common.cancel")}
        />

        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surfaceElevated,
              borderTopWidth: borderWidth.thin,
              borderColor: colors.divider,
              paddingBottom: spacing.xl,
            },
          ]}
        >
          <Text
            accessibilityRole="header"
            numberOfLines={2}
            style={[
              typography.subtitle,
              {
                color: colors.textPrimary,
                paddingHorizontal: spacing.lg,
                paddingTop: spacing.lg,
                paddingBottom: spacing.md,
              },
            ]}
          >
            {name}
          </Text>

          <View style={{ borderTopWidth: borderWidth.thin, borderColor: colors.divider }}>
            {actions.map((action) => (
              <Pressable
                key={action.key}
                onPress={() => run(action)}
                disabled={committing}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                accessibilityState={{ disabled: committing }}
                pressRetentionOffset={{ top: 12, bottom: 12, left: 16, right: 16 }}
                style={({ pressed }) => [
                  styles.row,
                  {
                    paddingHorizontal: spacing.lg,
                    paddingVertical: spacing.md,
                    borderBottomWidth: borderWidth.thin,
                    borderColor: colors.divider,
                    backgroundColor: pressed && !committing ? colors.surfaceMuted : "transparent",
                    opacity: committing ? 0.5 : 1,
                  },
                ]}
              >
                {/* No line limit: "Endgültig löschen" and "Импортировать
                    расписание" are half again as long as the English, and a row
                    that grows is better than one that clips. */}
                <Text
                  style={[typography.body, { color: action.destructive ? colors.danger : colors.textPrimary }]}
                >
                  {action.label}
                </Text>
                {action.description ? (
                  <Text style={[typography.caption, { color: colors.textMuted, marginTop: spacing.xs }]}>
                    {action.description}
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </View>

          <Pressable
            onPress={dismiss}
            disabled={committing}
            accessibilityRole="button"
            accessibilityLabel={t("common.cancel")}
            hitSlop={8}
            pressRetentionOffset={{ top: 16, bottom: 16, left: 24, right: 24 }}
            style={({ pressed }) => [
              styles.cancel,
              {
                marginTop: spacing.md,
                marginHorizontal: spacing.lg,
                paddingVertical: spacing.sm,
                borderRadius: radii.sm,
                opacity: committing ? 0.5 : pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text style={[typography.label, { color: colors.textSecondary }]}>{t("common.cancel")}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "flex-end",
  },
  scrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    width: "100%",
  },
  row: {
    justifyContent: "center",
    minHeight: 56,
  },
  cancel: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
});
