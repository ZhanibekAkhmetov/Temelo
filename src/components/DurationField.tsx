import { useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { WheelGroup, WheelPicker } from "@/components/WheelPicker";
import { formatDurationMinutes } from "@/domain/time";
import { useTheme } from "@/theme/useTheme";

/** Durations are set to the nearest five minutes, as lesson times are. */
const MINUTE_STEP = 5;
const DEFAULT_MAX_HOURS = 8;

const MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, index) => index * MINUTE_STEP);

interface DurationFieldProps {
  label: string;
  valueMinutes: number;
  onChange: (minutes: number) => void;
  /** Lowest total the picker will accept; 0 lets a duration be nothing at all. */
  minimumMinutes?: number;
  maximumHours?: number;
  helperText?: string;
}

/**
 * A length of time, shown as a readable result until tapped and then picked
 * on two wheels. Durations were plain numeric keyboard fields, which is the
 * one place in this app where a keyboard is worse than a picker: the values
 * are coarse, bounded and always multiples of five.
 *
 * The wheels edit a draft, never the field's own value, so Cancel and the
 * scrim need to do nothing but close: the value they leave behind is the one
 * that was there before the picker opened. Save commits the draft, which the
 * wheels keep in step with their centred rows.
 */
export function DurationField({
  label,
  valueMinutes,
  onChange,
  minimumMinutes = 0,
  maximumHours = DEFAULT_MAX_HOURS,
  helperText,
}: DurationFieldProps) {
  const { colors, spacing, radii, typography, borderWidth } = useTheme();
  const [isOpen, setOpen] = useState(false);
  const [draftHours, setDraftHours] = useState(0);
  const [draftMinutes, setDraftMinutes] = useState(0);

  // Stable identity, so committing a draft mid-scroll cannot hand the wheel a
  // new `values` array and rebuild its scroll handler under a moving finger.
  const hours = useMemo(() => Array.from({ length: maximumHours + 1 }, (_, index) => index), [maximumHours]);

  // The draft belongs to one visit to the picker: it is seeded from the field
  // as the picker opens, and thrown away on Cancel.
  function openPicker() {
    const total = Number.isFinite(valueMinutes) ? Math.max(0, Math.round(valueMinutes)) : 0;
    const snapped = Math.round(total / MINUTE_STEP) * MINUTE_STEP;
    setDraftHours(Math.min(maximumHours, Math.floor(snapped / 60)));
    setDraftMinutes(snapped % 60);
    setOpen(true);
  }

  const draftTotal = draftHours * 60 + draftMinutes;
  const canSave = draftTotal >= Math.max(0, minimumMinutes);

  function handleSave() {
    onChange(draftTotal);
    setOpen(false);
  }

  return (
    <View style={{ borderBottomWidth: borderWidth.thin, borderColor: colors.border }}>
      <Pressable
        onPress={openPicker}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${formatDurationMinutes(valueMinutes)}`}
        style={[styles.row, { paddingVertical: spacing.sm }]}
      >
        <Text style={[typography.label, { color: colors.textSecondary }]}>{label}</Text>
        <Text style={[typography.body, { color: colors.textPrimary }]}>{formatDurationMinutes(valueMinutes)}</Text>
      </Pressable>

      {helperText ? (
        <Text style={[typography.caption, { color: colors.textMuted, paddingBottom: spacing.xs }]}>{helperText}</Text>
      ) : null}

      <Modal visible={isOpen} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={[styles.scrim, { padding: spacing.lg }]}>
          {/* Dismiss-on-tap sits behind the card rather than around it, so it
              never competes with the wheels for the touch responder. */}
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} accessibilityLabel="Close" />

          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderWidth: borderWidth.thin,
                borderRadius: radii.lg,
                padding: spacing.lg,
              },
            ]}
          >
            <Text style={[typography.subtitle, { color: colors.textPrimary, marginBottom: spacing.md }]}>{label}</Text>
            <Text style={[typography.body, { color: colors.textSecondary, marginBottom: spacing.sm }]}>
              {formatDurationMinutes(draftTotal)}
            </Text>

            <WheelGroup>
              <WheelPicker values={hours} value={draftHours} onChange={setDraftHours} accessibilityLabel="Hours" />
              <Text style={[typography.label, styles.unit, { color: colors.textSecondary }]}>h</Text>
              <WheelPicker values={MINUTES} value={draftMinutes} onChange={setDraftMinutes} accessibilityLabel="Minutes" />
              <Text style={[typography.label, styles.unit, { color: colors.textSecondary }]}>min</Text>
            </WheelGroup>

            {canSave ? null : (
              <Text style={[typography.caption, { color: colors.destructive, marginTop: spacing.xs }]}>
                Must be at least {formatDurationMinutes(minimumMinutes)}.
              </Text>
            )}

            <View style={[styles.actions, { marginTop: spacing.lg, gap: spacing.sm }]}>
              <View style={styles.action}>
                <Button label="Cancel" variant="ghost" onPress={() => setOpen(false)} />
              </View>
              <View style={styles.action}>
                <Button label="Save" variant="primary" onPress={handleSave} disabled={!canSave} />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: 48,
  },
  scrim: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#00000066",
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
