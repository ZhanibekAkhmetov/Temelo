import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { ChoiceRow } from "@/components/ChoiceRow";
import { FieldRow, FieldValue } from "@/components/FieldRow";
import { ALL_WEEKDAYS_MONDAY_FIRST, normalizeVisibleWeekdays, type Weekday } from "@/domain/week";
import { daysLabel } from "@/features/timetables/summary";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/useTheme";

interface VisibleWeekdaysFieldProps {
  label: string;
  value: Weekday[];
  /** Called with a non-empty, Monday-first set once the user taps Done. */
  onChange: (days: Weekday[]) => void;
  helperText?: string;
}

/**
 * Which days a timetable shows, as one settings row that opens a list of the
 * seven days to tick.
 *
 * A draft and a Done rather than committing on every tap, unlike the app's
 * single-choice rows: going from Mon–Fri to Mon/Wed/Fri is three taps, and
 * the grid should not redraw — or the caller warn about hidden classes —
 * after each of them. At least one day has to stay ticked; Done is disabled
 * and says why until one is.
 */
export function VisibleWeekdaysField({ label, value, onChange, helperText }: VisibleWeekdaysFieldProps) {
  const { colors, spacing, radii, typography, borderWidth } = useTheme();
  const { t, format } = useI18n();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Weekday[]>(value);

  const valueText = daysLabel(t, format, value);
  const usable = normalizeVisibleWeekdays(draft);

  function openSheet() {
    setDraft(value);
    setOpen(true);
  }

  function toggle(day: Weekday) {
    setDraft((current) => (current.includes(day) ? current.filter((entry) => entry !== day) : [...current, day]));
  }

  function done() {
    if (!usable) return;
    setOpen(false);
    onChange(usable);
  }

  return (
    <FieldRow
      label={label}
      onPress={openSheet}
      accessibilityLabel={`${label}, ${valueText}`}
      helperText={helperText}
      panel={
        <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <View style={[styles.scrim, { backgroundColor: colors.overlay, padding: spacing.lg }]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} accessibilityLabel={t("common.close")} />
            <View
              style={[
                styles.card,
                {
                  backgroundColor: colors.surfaceElevated,
                  borderColor: colors.divider,
                  borderWidth: borderWidth.thin,
                  borderRadius: radii.lg,
                  padding: spacing.lg,
                },
              ]}
            >
              <Text style={[typography.subtitle, { color: colors.textPrimary, marginBottom: spacing.md }]}>{label}</Text>
              <WeekdayToggleList value={draft} onToggle={toggle} />
              <Text
                style={[
                  typography.caption,
                  { color: usable ? colors.textMuted : colors.danger, marginTop: spacing.sm },
                ]}
              >
                {usable ? t("week.visibleDaysHint") : t("week.atLeastOneDay")}
              </Text>
              <View style={[styles.actions, { marginTop: spacing.md, gap: spacing.sm }]}>
                <Pressable
                  onPress={() => setOpen(false)}
                  accessibilityRole="button"
                  hitSlop={8}
                  style={({ pressed }) => [styles.action, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <Text style={[typography.label, { color: colors.textSecondary }]}>{t("common.cancel")}</Text>
                </Pressable>
                <Pressable
                  onPress={done}
                  disabled={!usable}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !usable }}
                  hitSlop={8}
                  style={({ pressed }) => [styles.action, { opacity: !usable ? 0.4 : pressed ? 0.6 : 1 }]}
                >
                  <Text style={[typography.label, { color: colors.accentStrong, fontWeight: "700" }]}>{t("common.done")}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      }
    >
      <FieldValue>{valueText}</FieldValue>
    </FieldRow>
  );
}

/**
 * The seven days, Monday first, each a tick that can be toggled on its own.
 * Shared with the creation flow, which lists them inline instead of in a
 * sheet.
 */
export function WeekdayToggleList({ value, onToggle }: { value: Weekday[]; onToggle: (day: Weekday) => void }) {
  const { format } = useI18n();
  return (
    <View>
      {ALL_WEEKDAYS_MONDAY_FIRST.map((day) => (
        <ChoiceRow
          key={day}
          role="checkbox"
          label={format.weekdayLong(day)}
          selected={value.includes(day)}
          onPress={() => onToggle(day)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    width: "100%",
    maxWidth: 340,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  action: {
    minHeight: 44,
    minWidth: 64,
    alignItems: "center",
    justifyContent: "center",
  },
});
