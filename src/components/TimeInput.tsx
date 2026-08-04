import { applyMaskedChange, type DigitMaskSpec } from "@/components/digitMask";
import { MaskedField } from "@/components/MaskedField";

interface TimeInputProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  error?: string;
  helperText?: string;
}

const TIME_MASK: DigitMaskSpec = { groupSizes: [2, 2], separator: ":" };
const TIME_PLACEHOLDER = "HH:mm";

/**
 * Reusable HH:mm masked input: digits only, colon auto-inserted after the
 * hour, natural backspace across the colon, pasted/normalized text
 * accepted. Stores and returns a plain HH:mm-shaped string — semantic
 * validation (valid hour/minute range) stays with the existing
 * generateTimeSlots/isValidHHmm domain logic, not duplicated here.
 */
export function TimeInput({ label, value, onChangeText, error, helperText }: TimeInputProps) {
  function handleRawChange(newRawText: string) {
    onChangeText(applyMaskedChange(newRawText, value, TIME_MASK));
  }

  return (
    <MaskedField
      label={label}
      typedPrefix={value}
      fullMask={TIME_PLACEHOLDER}
      onChangeRawText={handleRawChange}
      maxLength={5}
      error={error}
      helperText={helperText}
    />
  );
}
