import { FieldRow, FieldValue } from "@/components/FieldRow";
import { useI18n } from "@/i18n/I18nProvider";

interface DateFieldProps {
  label: string;
  /** ISO date. */
  value: string;
  /** Opens the screen's `DatePickerSheet`. */
  onPress: () => void;
  helperText?: string;
  error?: string;
}

/**
 * A date as a form row: the label, and the date in words.
 *
 * The row only asks for the picker; the screen owns and draws the
 * `DatePickerSheet`, because the sheet has to cover the whole screen and a
 * row sits inside a scrolling form that it could never escape from.
 */
export function DateField({ label, value, onPress, helperText, error }: DateFieldProps) {
  const { format } = useI18n();
  const text = format.dateLong(value);

  return (
    <FieldRow
      label={label}
      onPress={onPress}
      accessibilityLabel={`${label}, ${text}`}
      helperText={helperText}
      error={error}
    >
      <FieldValue>{text}</FieldValue>
    </FieldRow>
  );
}
