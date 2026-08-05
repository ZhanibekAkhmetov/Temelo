import { Pressable, StyleSheet, Text, View } from "react-native";

import { dayOfMonth, isSameMonth, MONTH_GRID_ROW_COUNT, monthGridWeeks } from "@/domain/calendar";
import { ALL_WEEKDAYS_MONDAY_FIRST, isWeekendDay, WEEKDAY_SHORT_LABEL } from "@/domain/week";
import { useTheme } from "@/theme/useTheme";

const WEEKDAY_ROW_HEIGHT = 22;
const DAY_ROW_HEIGHT = 36;
const DAY_MARKER_SIZE = 30;

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
 */
export function CalendarMonth({ month, width, value, today, onSelect }: CalendarMonthProps) {
  const { colors, typography, radii } = useTheme();
  const weeks = monthGridWeeks(month);

  return (
    <View style={{ width }}>
      <View style={[styles.week, { height: WEEKDAY_ROW_HEIGHT }]}>
        {ALL_WEEKDAYS_MONDAY_FIRST.map((day) => (
          <View key={day} style={styles.dayCell}>
            <Text style={[typography.gridSecondary, { color: isWeekendDay(day) ? colors.destructive : colors.textMuted }]}>
              {WEEKDAY_SHORT_LABEL[day].slice(0, 2).toUpperCase()}
            </Text>
          </View>
        ))}
      </View>

      {weeks.map((week) => (
        <View key={week[0]} style={[styles.week, { height: DAY_ROW_HEIGHT }]}>
          {week.map((date) => {
            const isSelected = date === value;
            const isToday = date === today;
            const inMonth = isSameMonth(date, month);
            const textColor = isSelected
              ? colors.background
              : !inMonth
                ? colors.textMuted
                : isToday
                  ? colors.accent
                  : colors.textPrimary;
            return (
              <Pressable
                key={date}
                onPress={() => onSelect(date)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={date}
                style={styles.dayCell}
              >
                <View
                  style={[
                    styles.dayMarker,
                    {
                      borderRadius: radii.lg,
                      backgroundColor: isSelected ? colors.accent : "transparent",
                      borderColor: isToday && !isSelected ? colors.accent : "transparent",
                      borderWidth: isToday && !isSelected ? 1 : 0,
                    },
                  ]}
                >
                  <Text style={[typography.body, { color: textColor, fontWeight: isSelected ? "700" : "400" }]}>
                    {dayOfMonth(date)}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

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
