import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { SelectedCell, SlotChoice } from "@/features/timetable/types";
import { useI18n } from "@/i18n/I18nProvider";
import { getClassColors } from "@/theme/classColors";
import { useSheetFrame } from "@/theme/useSheetFrame";
import { useTheme } from "@/theme/useTheme";

interface SlotClassesSheetProps {
  choice: SlotChoice;
  /** One of the classes was picked: open its editor. */
  onSelect: (selection: SelectedCell) => void;
  /** "Add class here": open a new-class editor for the tapped cell. */
  onAdd: (selection: SelectedCell) => void;
  onCancel: () => void;
}

/**
 * Which of the classes in this slot did you mean?
 *
 * Overlapping classes are drawn side by side, and on a phone a lane can be a
 * third of an already narrow column — fine to recognise a colour by, not fine
 * to aim at. So a tap on a cell holding more than one class lands here: one
 * full-width row per class, each opening that class's own editor (where it can
 * be viewed, changed or deleted on its own), and a last row to add yet another
 * class at the same time.
 *
 * Nothing is written from here. It only decides which editor opens.
 */
export function SlotClassesSheet({ choice, onSelect, onAdd, onCancel }: SlotClassesSheetProps) {
  const { colors, spacing, radii, typography, borderWidth } = useTheme();
  // A centred dialog on a desktop; unchanged on a phone.
  const frame = useSheetFrame();
  const { t, format } = useI18n();

  const cell = choice.newClass;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={[styles.root, frame.root]}>
        <Pressable
          style={[styles.scrim, { backgroundColor: colors.scrim }]}
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel={t("common.cancel")}
        />

        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surfaceElevated,
              borderTopWidth: borderWidth.thin,
              borderColor: colors.divider,
              paddingBottom: spacing.xl,
            },
            frame.sheet,
          ]}
        >
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md }}>
            <Text style={[typography.subtitle, { color: colors.textPrimary }]}>{t("slotChooser.title")}</Text>
            <Text style={[typography.caption, { color: colors.textMuted, marginTop: 2 }]}>
              {t("classEditor.slot", {
                weekday: format.weekdayLong(cell.weekday),
                period: cell.timeSlot.position,
                start: cell.timeSlot.startTime,
                end: cell.endTime,
              })}
            </Text>
          </View>

          <ScrollView style={styles.list} contentContainerStyle={{ borderTopWidth: borderWidth.thin, borderColor: colors.divider }}>
            {choice.classes.map((selection) => {
              const existing = selection.existing;
              if (!existing) return null;
              const appearance = getClassColors(existing.course.appearanceId);
              const time = `${selection.timeSlot.startTime}–${selection.endTime}`;
              const detail = existing.course.room ? `${time} · ${existing.course.room}` : time;
              return (
                <Pressable
                  key={existing.occurrenceId}
                  onPress={() => onSelect(selection)}
                  accessibilityRole="button"
                  accessibilityLabel={existing.course.name}
                  accessibilityHint={detail}
                  pressRetentionOffset={{ top: 12, bottom: 12, left: 16, right: 16 }}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      paddingHorizontal: spacing.lg,
                      paddingVertical: spacing.md,
                      gap: spacing.md,
                      borderBottomWidth: borderWidth.thin,
                      borderColor: colors.divider,
                      backgroundColor: pressed ? colors.surfaceMuted : "transparent",
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.swatch,
                      { backgroundColor: appearance.fill, borderColor: appearance.edge, borderRadius: radii.sm },
                    ]}
                  />
                  <View style={styles.rowText}>
                    <Text style={[typography.body, { color: colors.textPrimary }]} numberOfLines={2}>
                      {existing.course.name}
                    </Text>
                    <Text style={[typography.caption, { color: colors.textMuted, marginTop: 2 }]} numberOfLines={1}>
                      {detail}
                    </Text>
                  </View>
                </Pressable>
              );
            })}

            <Pressable
              onPress={() => onAdd(cell)}
              accessibilityRole="button"
              accessibilityLabel={t("slotChooser.addHere")}
              pressRetentionOffset={{ top: 12, bottom: 12, left: 16, right: 16 }}
              style={({ pressed }) => [
                styles.row,
                {
                  paddingHorizontal: spacing.lg,
                  paddingVertical: spacing.md,
                  gap: spacing.md,
                  borderBottomWidth: borderWidth.thin,
                  borderColor: colors.divider,
                  backgroundColor: pressed ? colors.surfaceMuted : "transparent",
                },
              ]}
            >
              <View style={[styles.swatch, styles.addSwatch, { borderColor: colors.accent, borderRadius: radii.sm }]}>
                <Text style={[styles.plus, { color: colors.accent }]}>+</Text>
              </View>
              <Text style={[typography.body, { color: colors.accentStrong }]}>{t("slotChooser.addHere")}</Text>
            </Pressable>
          </ScrollView>

          <Pressable
            onPress={onCancel}
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
                opacity: pressed ? 0.7 : 1,
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
    maxHeight: "80%",
  },
  list: {
    flexGrow: 0,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 56,
  },
  rowText: {
    flex: 1,
  },
  swatch: {
    width: 20,
    height: 20,
    borderWidth: 1,
  },
  addSwatch: {
    alignItems: "center",
    justifyContent: "center",
  },
  plus: {
    fontSize: 16,
    lineHeight: 18,
    fontWeight: "500",
  },
  cancel: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
});
