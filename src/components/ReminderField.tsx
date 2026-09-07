import { useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { FieldRow, FieldValue } from "@/components/FieldRow";
import { ChoiceRow } from "@/components/ChoiceRow";
import { WheelGroup, WheelPicker } from "@/components/WheelPicker";
import { MAX_REMINDER_HOURS, REMINDER_PRESETS, type ReminderMinutes } from "@/domain/reminder";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/useTheme";

/** Custom lead times are picked to the nearest five minutes, as durations are. */
const MINUTE_STEP = 5;
const MINIMUM_CUSTOM_MINUTES = 5;

const MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, index) => index * MINUTE_STEP);

/** Which kind of choice the picker is currently on. */
type ReminderKind = "preset" | "custom" | "none";

interface ReminderFieldProps {
  label: string;
  value: ReminderMinutes;
  onChange: (minutes: ReminderMinutes) => void;
  helperText?: string;
}

function kindOf(value: ReminderMinutes): ReminderKind {
  if (value === null) return "none";
  return REMINDER_PRESETS.includes(value) ? "preset" : "custom";
}

/**
 * A class's reminder, as one compact row that opens a short list.
 *
 * The five choices are one list rather than a segmented control plus a
 * separate field, because "None" and "Custom" are the same kind of decision
 * as "30 minutes before" — and putting Custom's wheels inside the same sheet
 * keeps a custom lead time from being a detour to somewhere else and back.
 *
 * The wheels are the ones durations use, and for the same reason: the values
 * are coarse, bounded and always multiples of five, which is exactly where a
 * picker beats a keyboard. Everything the sheet edits is a draft, so Cancel
 * and the scrim need only close.
 */
export function ReminderField({ label, value, onChange, helperText }: ReminderFieldProps) {
  const { colors, spacing, radii, typography, borderWidth } = useTheme();
  const { t, format } = useI18n();
  const [isOpen, setOpen] = useState(false);
  const [draftKind, setDraftKind] = useState<ReminderKind>("preset");
  const [draftPreset, setDraftPreset] = useState(REMINDER_PRESETS[1]);
  const [draftHours, setDraftHours] = useState(0);
  const [draftMinutes, setDraftMinutes] = useState(0);

  // Stable identity, so committing a draft mid-scroll cannot hand a wheel a
  // new `values` array while a finger is still on it.
  const hours = useMemo(() => Array.from({ length: MAX_REMINDER_HOURS + 1 }, (_, index) => index), []);

  function openPicker() {
    const kind = kindOf(value);
    setDraftKind(kind);
    setDraftPreset(kind === "preset" && value !== null ? value : REMINDER_PRESETS[1]);

    // The wheels start from the current value when it is already a custom
    // one, and from a sensible lead time otherwise.
    const seed = kind === "custom" && value !== null ? value : REMINDER_PRESETS[1];
    const snapped = Math.round(seed / MINUTE_STEP) * MINUTE_STEP;
    setDraftHours(Math.min(MAX_REMINDER_HOURS, Math.floor(snapped / 60)));
    setDraftMinutes(snapped % 60);
    setOpen(true);
  }

  const customTotal = draftHours * 60 + draftMinutes;
  const draftValue: ReminderMinutes =
    draftKind === "none" ? null : draftKind === "preset" ? draftPreset : customTotal;
  const canSave = draftKind !== "custom" || customTotal >= MINIMUM_CUSTOM_MINUTES;

  function handleSave() {
    onChange(draftValue);
    setOpen(false);
  }

  return (
    <FieldRow
      label={label}
      onPress={openPicker}
      accessibilityLabel={`${label}, ${format.reminderValue(value)}`}
      helperText={helperText}
      panel={
        <Modal visible={isOpen} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <View style={[styles.scrim, { backgroundColor: colors.overlay, padding: spacing.lg }]}>
            {/* Dismiss-on-tap sits behind the card rather than around it, so it
                never competes with the wheels for the touch responder. */}
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setOpen(false)}
              accessibilityLabel={t("common.close")}
            />

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

              <View accessibilityRole="radiogroup" accessibilityLabel={label}>
                {REMINDER_PRESETS.map((minutes) => (
                  <ChoiceRow
                    key={minutes}
                    label={format.reminderValue(minutes)}
                    selected={draftKind === "preset" && draftPreset === minutes}
                    onPress={() => {
                      setDraftKind("preset");
                      setDraftPreset(minutes);
                    }}
                  />
                ))}
                <ChoiceRow
                  label={t("common.custom")}
                  selected={draftKind === "custom"}
                  onPress={() => setDraftKind("custom")}
                />
                <ChoiceRow label={t("common.none")} selected={draftKind === "none"} onPress={() => setDraftKind("none")} />
              </View>

              {draftKind === "custom" ? (
                <View style={{ marginTop: spacing.md }}>
                  <Text style={[typography.body, { color: colors.textSecondary, marginBottom: spacing.sm }]}>
                    {format.reminderValue(customTotal)}
                  </Text>
                  <WheelGroup>
                    <WheelPicker
                      values={hours}
                      value={draftHours}
                      onChange={setDraftHours}
                      accessibilityLabel={t("reminders.hoursBefore")}
                    />
                    <Text style={[typography.label, styles.unit, { color: colors.textSecondary }]}>
                      {t("common.hoursUnit")}
                    </Text>
                    <WheelPicker
                      values={MINUTES}
                      value={draftMinutes}
                      onChange={setDraftMinutes}
                      accessibilityLabel={t("reminders.minutesBefore")}
                    />
                    <Text style={[typography.label, styles.unit, { color: colors.textSecondary }]}>
                      {t("common.minutesUnit")}
                    </Text>
                  </WheelGroup>
                  {canSave ? null : (
                    <Text style={[typography.caption, { color: colors.danger, marginTop: spacing.xs }]}>
                      {t("reminders.customMinimum", { minutes: MINIMUM_CUSTOM_MINUTES })}
                    </Text>
                  )}
                </View>
              ) : null}

              <View style={[styles.actions, { marginTop: spacing.lg, gap: spacing.sm }]}>
                <View style={styles.action}>
                  <Button label={t("common.cancel")} variant="ghost" onPress={() => setOpen(false)} />
                </View>
                <View style={styles.action}>
                  <Button label={t("common.save")} variant="primary" onPress={handleSave} disabled={!canSave} />
                </View>
              </View>
            </View>
          </View>
        </Modal>
      }
    >
      <FieldValue>{format.reminderValue(value)}</FieldValue>
    </FieldRow>
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
  unit: {
    paddingHorizontal: 4,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  action: {
    minWidth: 96,
  },
});
