/**
 * Shared masking logic behind TimeInput and DateInput: digits typed
 * left-to-right, grouped with a separator inserted automatically once a
 * group is complete (e.g. HH:mm or DD.MM.YYYY), and natural backspacing
 * across an auto-inserted separator. Kept framework-free so both inputs
 * reuse exactly one implementation.
 */

export interface DigitMaskSpec {
  /** Digit-count of each group, in entry order, e.g. [2, 2] for HH:mm. */
  groupSizes: number[];
  separator: string;
}

export function maxDigitsFor(spec: DigitMaskSpec): number {
  return spec.groupSizes.reduce((total, size) => total + size, 0);
}

export function formatMaskedDigits(digits: string, spec: DigitMaskSpec): string {
  const groups: string[] = [];
  let cursor = 0;
  for (const size of spec.groupSizes) {
    if (cursor >= digits.length) break;
    groups.push(digits.slice(cursor, cursor + size));
    cursor += size;
  }

  return groups
    .map((group, index) => {
      const isCompleteGroup = group.length === spec.groupSizes[index];
      const isLastGroup = index === spec.groupSizes.length - 1;
      return isCompleteGroup && !isLastGroup ? `${group}${spec.separator}` : group;
    })
    .join("");
}

/**
 * Given the TextInput's raw new text and the previously-rendered masked
 * value, returns the next masked value. Handles plain typing, pasted text
 * (stripped to digits, capped at the mask's total length), and backspacing
 * an auto-inserted separator (which also removes the digit before it, so
 * backspace feels continuous instead of getting stuck on the separator).
 */
export function applyMaskedChange(newRawText: string, previousFormatted: string, spec: DigitMaskSpec): string {
  const deletedOnlySeparator =
    newRawText.length < previousFormatted.length &&
    previousFormatted.endsWith(spec.separator) &&
    newRawText === previousFormatted.slice(0, -1);

  const digits = deletedOnlySeparator
    ? newRawText.replace(/\D/g, "").slice(0, -1)
    : newRawText.replace(/\D/g, "").slice(0, maxDigitsFor(spec));

  return formatMaskedDigits(digits, spec);
}
