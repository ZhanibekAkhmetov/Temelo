import { useState } from "react";

import { applyMaskedChange, formatMaskedDigits, type DigitMaskSpec } from "@/components/digitMask";
import { MaskedField } from "@/components/MaskedField";
import { dmyDigitsToIso, isoToDmyDigits } from "@/domain/date";

interface DateInputProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  error?: string;
  helperText?: string;
}

const DATE_MASK: DigitMaskSpec = { groupSizes: [2, 2, 4], separator: "." };
const DATE_PLACEHOLDER = "DD.MM.YYYY";

/**
 * Reusable DD.MM.YYYY masked date input. DD.MM.YYYY is entered
 * least-significant-first, which can't be represented as a partial ISO
 * prefix while typing — so unlike TimeInput this component buffers its own
 * DD.MM.YYYY digits locally and only reports a value to the parent once
 * all 8 digits are entered, converting to the app's internal ISO
 * (YYYY-MM-DD) storage format at that point. An incomplete date reports
 * "" upward, which the existing isValidIsoDate-based validation already
 * treats as invalid — no new validation logic needed at call sites.
 */
export function DateInput({ label, value, onChangeText, error, helperText }: DateInputProps) {
  const [displayValue, setDisplayValue] = useState(() => formatMaskedDigits(isoToDmyDigits(value), DATE_MASK));

  function handleRawChange(newRawText: string) {
    const next = applyMaskedChange(newRawText, displayValue, DATE_MASK);
    setDisplayValue(next);
    const digits = next.replace(/\D/g, "");
    onChangeText(digits.length === 8 ? dmyDigitsToIso(digits) : "");
  }

  return (
    <MaskedField
      label={label}
      typedPrefix={displayValue}
      fullMask={DATE_PLACEHOLDER}
      onChangeRawText={handleRawChange}
      maxLength={10}
      error={error}
      helperText={helperText}
    />
  );
}
