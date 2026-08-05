import { StyleSheet, Text } from "react-native";

import { CollapsibleField } from "@/components/CollapsibleField";
import { WheelGroup, WheelPicker, WHEEL_HEIGHT } from "@/components/WheelPicker";
import { joinHHmm, splitHHmm } from "@/domain/time";
import { useTheme } from "@/theme/useTheme";

/** Lesson times are set to the nearest five minutes, as in the reference design. */
const MINUTE_STEP = 5;

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, index) => index * MINUTE_STEP);

export const TIME_PANEL_HEIGHT = WHEEL_HEIGHT;

interface InlineTimeFieldProps {
  label: string;
  /** HH:mm. */
  value: string;
  onChange: (value: string) => void;
  expanded: boolean;
  onToggle: () => void;
  helperText?: string;
}

function roundToStep(minutes: number): number {
  return Math.min(60 - MINUTE_STEP, Math.round(minutes / MINUTE_STEP) * MINUTE_STEP);
}

/**
 * Time entry as in the reference design: the time alone until tapped, then
 * two snapping wheels unfold underneath it — hours, and minutes in
 * five-minute steps.
 */
export function InlineTimeField({ label, value, onChange, expanded, onToggle, helperText }: InlineTimeFieldProps) {
  const { colors, typography } = useTheme();

  const parsed = splitHHmm(value) ?? { hours: 8, minutes: 0 };
  const hours = parsed.hours;
  const minutes = roundToStep(parsed.minutes);

  return (
    <CollapsibleField
      label={label}
      valueText={joinHHmm(hours, minutes)}
      expanded={expanded}
      onToggle={onToggle}
      panelHeight={TIME_PANEL_HEIGHT}
      helperText={helperText}
    >
      <WheelGroup>
        <WheelPicker values={HOURS} value={hours} onChange={(hour) => onChange(joinHHmm(hour, minutes))} accessibilityLabel="Hour" />
        <Text style={[typography.title, styles.separator, { color: colors.textPrimary }]}>:</Text>
        <WheelPicker
          values={MINUTES}
          value={minutes}
          onChange={(minute) => onChange(joinHHmm(hours, minute))}
          accessibilityLabel="Minute"
        />
      </WheelGroup>
    </CollapsibleField>
  );
}

const styles = StyleSheet.create({
  separator: {
    paddingHorizontal: 8,
  },
});
