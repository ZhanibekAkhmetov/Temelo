import { CollapsibleField } from "@/components/CollapsibleField";
import { MonthPager, MONTH_PAGER_HEIGHT } from "@/components/MonthPager";
import { formatIsoLong } from "@/domain/calendar";
import { todayIsoDate } from "@/domain/date";

interface InlineDateFieldProps {
  label: string;
  /** ISO date. */
  value: string;
  onChange: (isoDate: string) => void;
  expanded: boolean;
  onToggle: () => void;
  error?: string;
  helperText?: string;
}

/**
 * Date entry as in the reference design: the date alone until tapped, then
 * a swipeable month grid unfolds underneath it. `expanded` is controlled by
 * the screen so that opening one field closes any other.
 */
export function InlineDateField({ label, value, onChange, expanded, onToggle, error, helperText }: InlineDateFieldProps) {
  const today = todayIsoDate();
  const selected = value || today;

  return (
    <CollapsibleField
      label={label}
      valueText={formatIsoLong(selected)}
      expanded={expanded}
      onToggle={onToggle}
      panelHeight={MONTH_PAGER_HEIGHT}
      error={error}
      helperText={helperText}
    >
      {/* Opening the field re-anchors the pager on the selected month;
          browsing away from it inside one session is left alone. Keyed on
          the open state alone, so that picking a date — a day of the next
          month off the end of the grid, above all — leaves the pager where
          the user put it instead of remounting it a month along. */}
      <MonthPager key={String(expanded)} value={selected} today={today} onSelect={onChange} />
    </CollapsibleField>
  );
}
