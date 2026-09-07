import { memo, useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { dayOfMonth, isSameMonth, MONTH_GRID_ROW_COUNT, monthGridWeeks } from "@/domain/calendar";
import { ALL_WEEKDAYS_MONDAY_FIRST, isWeekendDay } from "@/domain/week";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/useTheme";

const WEEKDAY_ROW_HEIGHT = 22;
/*
 * A day cell is 44 points tall and a seventh of the field wide — the target
 * anyone has to be able to hit without aiming. The marker drawn inside it stays
 * smaller, because the circle is the *selection*, not the button: growing it to
 * fill the cell would put adjacent days' circles in contact.
 *
 * No `hitSlop` here, deliberately. Every neighbour is another day, so slop
 * would only take a touch from the cell next door.
 */
const DAY_ROW_HEIGHT = 44;
const DAY_MARKER_SIZE = 34;

/** Fixed by the always-six-row grid, so the pager and the field can size to it. */
export const CALENDAR_MONTH_GRID_HEIGHT = WEEKDAY_ROW_HEIGHT + DAY_ROW_HEIGHT * MONTH_GRID_ROW_COUNT;

interface CalendarMonthProps {
  /** Any date inside the month to draw. */
  month: string;
  width: number;
  /** Selected date, ISO — may belong to another month. */
  value: string;
  today: string;
  onSelect: (isoDate: string) => void;
}

/**
 * One month, Monday-first, always six rows so every page of the pager is
 * the same height. Purely presentational: which month is on screen is the
 * pager's business, which keeps the selection marker attached to whichever
 * page actually contains the selected date.
 *
 * Forty-two cells is a lot of views to build, and the pager keeps five months
 * alive at once, so this is written to be cheap in the two ways that matter:
 * the marker behind a day is only rendered for the two days that have one, and
 * every cell is memoised on primitives, so picking a date re-renders the two
 * cells that changed rather than all two hundred on screen.
 */
export const CalendarMonth = memo(function CalendarMonth({
  month,
  width,
  value,
  today,
  onSelect,
}: CalendarMonthProps) {
  const { colors, typography } = useTheme();
  const { format } = useI18n();
  const weeks = monthGridWeeks(month);

  return (
    <View style={{ width }}>
      <View style={[styles.week, { height: WEEKDAY_ROW_HEIGHT }]}>
        {ALL_WEEKDAYS_MONDAY_FIRST.map((day) => (
          <View key={day} style={styles.dayCell}>
            <Text style={[typography.gridSecondary, { color: isWeekendDay(day) ? colors.weekendText : colors.textMuted }]}>
              {format.weekdayNarrow(day).toUpperCase()}
            </Text>
          </View>
        ))}
      </View>

      {weeks.map((week) => (
        <View key={week[0]} style={[styles.week, { height: DAY_ROW_HEIGHT }]}>
          {week.map((date) => (
            <DayCell
              key={date}
              date={date}
              selected={date === value}
              today={date === today}
              inMonth={isSameMonth(date, month)}
              onSelect={onSelect}
            />
          ))}
        </View>
      ))}
    </View>
  );
});

const DayCell = memo(function DayCell({
  date,
  selected,
  today,
  inMonth,
  onSelect,
}: {
  date: string;
  selected: boolean;
  today: boolean;
  inMonth: boolean;
  onSelect: (isoDate: string) => void;
}) {
  const { colors, typography, radii } = useTheme();
  const press = useCallback(() => onSelect(date), [date, onSelect]);

  const textColor = selected
    ? colors.textOnAccent
    : !inMonth
      ? colors.textMuted
      : today
        ? colors.accent
        : colors.textPrimary;

  // Most days have no marker at all, so most days are two views rather than
  // three. Across five mounted months that is two hundred views not built.
  const marked = selected || today;
  const label = (
    <Text style={[typography.body, { color: textColor, fontWeight: selected ? "700" : "400" }]}>
      {dayOfMonth(date)}
    </Text>
  );

  return (
    <Pressable
      onPress={press}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={date}
      pressRetentionOffset={{ top: 10, bottom: 10, left: 10, right: 10 }}
      style={({ pressed }) => [styles.dayCell, { opacity: pressed && !selected ? 0.55 : 1 }]}
    >
      {marked ? (
        <View
          style={[
            styles.dayMarker,
            {
              borderRadius: radii.lg,
              backgroundColor: selected ? colors.accent : "transparent",
              borderColor: today && !selected ? colors.accent : "transparent",
              borderWidth: today && !selected ? 1 : 0,
            },
          ]}
        >
          {label}
        </View>
      ) : (
        label
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  week: {
    flexDirection: "row",
    alignItems: "center",
  },
  dayCell: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dayMarker: {
    width: DAY_MARKER_SIZE,
    height: DAY_MARKER_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
});
