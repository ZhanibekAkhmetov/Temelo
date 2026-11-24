import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

import { CalendarMonth } from "@/components/CalendarMonth";
import { ChoiceRowField } from "@/components/ChoiceRowField";
import { ReminderField } from "@/components/ReminderField";
import { SegmentedControl } from "@/components/SegmentedControl";
import { addMonthsIso } from "@/domain/calendar";
import { ALL_WEEKDAYS_MONDAY_FIRST, type Weekday } from "@/domain/week";
import { useReminderStatus } from "@/features/reminders/useReminderStatus";
import { reminderHelperKey, useSettingOptions } from "@/features/settings/options";
import { shapeOfActive, timetableSummary } from "@/features/timetables/summary";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppState } from "@/state/AppStateContext";
import { useTheme } from "@/theme/useTheme";

/** Wide enough for a seven-column month and a three-way segmented control. */
export const DESKTOP_SIDEBAR_WIDTH = 296;
const SIDEBAR_PADDING = 16;
const CARD_PADDING = 14;
const MONTH_WIDTH = DESKTOP_SIDEBAR_WIDTH - SIDEBAR_PADDING * 2;

interface DesktopSidebarProps {
  today: string;
  /** Called with any date; the week containing it is shown. */
  onSelectDate: (isoDate: string) => void;
  onOpenAbout: () => void;
}

/**
 * The desktop's left-hand column: where the week is, and every setting that is
 * one choice.
 *
 * The phone keeps these behind the menu, on a Settings screen, because a
 * phone has no room beside the grid. A desktop has, so the settings live next
 * to the thing they change and take effect in plain view — switching the
 * layout or hiding Saturday redraws the week beside the control. The same rule
 * the Settings screen keeps holds here: a single choice applies the moment it
 * is made; a setting that is several fields at once opens a dialog of its own
 * (the timetable, its academic day, the archive).
 *
 * The layout is a month to jump through, then one card per subject — the
 * timetable, how it is drawn, the app, reminders — each with its title inside
 * it, and every control in the same shape: its label above it. About is a
 * quiet link at the foot, as on every desktop app.
 */
export function DesktopSidebar({ today, onSelectDate, onOpenAbout }: DesktopSidebarProps) {
  const { colors, spacing, typography, borderWidth } = useTheme();
  const { t, format } = useI18n();
  const {
    state,
    setVisibleWeekdays,
    setGridOrientation,
    setAppearancePreference,
    setLanguagePreference,
    setDefaultReminder,
  } = useAppState();
  const reminderStatus = useReminderStatus();
  const options = useSettingOptions();

  // The month being looked at here, independently of the week on the grid:
  // browsing ahead to check a date should not move the timetable.
  const [month, setMonth] = useState(today);
  const [picked, setPicked] = useState(today);

  function pick(date: string) {
    setPicked(date);
    onSelectDate(date);
  }

  const timetable = state.timetable;

  return (
    <ScrollView
      // The column scrolls only when the window is short; a permanent bright
      // scrollbar down the middle of the app would be the loudest thing on it.
      showsVerticalScrollIndicator={false}
      style={[styles.sidebar, { borderRightWidth: borderWidth.thin, borderColor: colors.divider }]}
      contentContainerStyle={{ padding: SIDEBAR_PADDING, gap: spacing.md }}
    >
      {/* ---------------------------------------------------------- month */}
      <View>
        <View style={[styles.monthHeader, { marginBottom: spacing.xs }]}>
          <Text style={[typography.label, styles.monthTitle, { color: colors.textPrimary }]} numberOfLines={1}>
            {format.monthYear(month)}
          </Text>
          <IconButton glyph="‹" label={t("desktop.previousMonth")} onPress={() => setMonth(addMonthsIso(month, -1))} />
          <IconButton glyph="›" label={t("desktop.nextMonth")} onPress={() => setMonth(addMonthsIso(month, 1))} />
        </View>
        <CalendarMonth compact month={month} width={MONTH_WIDTH} value={picked} today={today} onSelect={pick} />
      </View>

      {/* ------------------------------------------------------ timetable */}
      <Card title={t("settings.sectionTimetable")}>
        <HoverRow onPress={() => router.push(timetable ? "/timetables/current" : "/timetables")}>
          <View style={styles.flex}>
            <Text style={[typography.subtitle, { color: colors.textPrimary, fontWeight: "600" }]} numberOfLines={1}>
              {timetable?.name ?? t("timetables.noCurrent")}
            </Text>
            <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 2 }]} numberOfLines={2}>
              {timetable
                ? timetableSummary(t, format, shapeOfActive(state.settings.visibleWeekdays, state.timeSlots))
                : t("timetables.noCurrentHint")}
            </Text>
          </View>
          <Text style={[styles.chevron, { color: colors.textMuted }]}>›</Text>
        </HoverRow>
        <View style={[styles.rule, { backgroundColor: colors.divider }]} />
        <HoverRow onPress={() => router.push("/timetables")}>
          <Text style={[typography.label, styles.flex, { color: colors.accentStrong }]}>{t("desktop.allTimetables")}</Text>
          <Text style={[styles.chevron, { color: colors.textMuted }]}>›</Text>
        </HoverRow>
      </Card>

      {/* ----------------------------------------------------------- view */}
      <Card title={t("desktop.sectionView")}>
        {timetable ? (
          <Control label={t("timetables.days")}>
            <WeekdayChips
              value={state.settings.visibleWeekdays}
              onChange={(visibleWeekdays) => setVisibleWeekdays({ visibleWeekdays })}
            />
          </Control>
        ) : null}
        <Control label={t("settings.layout")}>
          <SegmentedControl
            label={t("settings.layout")}
            value={state.settings.gridOrientation}
            options={options.layout}
            onChange={(gridOrientation) => setGridOrientation({ gridOrientation })}
          />
        </Control>
      </Card>

      {/* -------------------------------------------------------- general */}
      <Card title={t("settings.sectionGeneral")}>
        <Control label={t("settings.appearance")}>
          <SegmentedControl
            label={t("settings.appearance")}
            value={state.settings.appearancePreference}
            options={options.appearance}
            onChange={(appearancePreference) => setAppearancePreference({ appearancePreference })}
          />
        </Control>
        {/* Four languages do not fit across, so this one opens a short list. */}
        <ChoiceRowField
          appearance="select"
          label={t("settings.language")}
          value={state.settings.languagePreference}
          options={options.language}
          onChange={(languagePreference) => setLanguagePreference({ languagePreference })}
          sheetTitle={t("settings.chooseLanguage")}
        />
      </Card>

      {/* ------------------------------------------------------ reminders */}
      <Card title={t("reminders.title")}>
        <ReminderField
          appearance="select"
          label={t("reminders.defaultForNewClasses")}
          value={state.settings.defaultReminderMinutes}
          onChange={(reminderMinutes) => setDefaultReminder({ reminderMinutes })}
          helperText={t(reminderHelperKey(reminderStatus.permission))}
        />
      </Card>

      {/* ---------------------------------------------------------- about */}
      <View style={styles.footer}>
        <FooterLink label={t("desktop.aboutTemelo")} onPress={onOpenAbout} />
        {/* The full Settings screen still holds the development tools. */}
        {__DEV__ ? <FooterLink label={t("settings.developer")} onPress={() => router.push("/settings")} /> : null}
      </View>
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ parts */

/** One subject of the sidebar: a panel with its title inside it. */
function Card({ title, children }: { title: string; children: ReactNode }) {
  const { colors, radii, typography, borderWidth, spacing } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: radii.lg * 1.2,
        borderWidth: borderWidth.thin,
        borderColor: colors.divider,
        padding: CARD_PADDING,
        gap: spacing.md,
      }}
    >
      <Text accessibilityRole="header" style={[typography.caption, styles.cardTitle, { color: colors.textMuted }]}>
        {title}
      </Text>
      {children}
    </View>
  );
}

/** A control with its label above it — the one shape every setting here has. */
function Control({ label, children }: { label: string; children: ReactNode }) {
  const { colors, typography } = useTheme();
  return (
    <View>
      <Text style={[typography.caption, { color: colors.textSecondary, marginBottom: 6 }]}>{label}</Text>
      {children}
    </View>
  );
}

/** A full-width row that answers the pointer: a hover wash, as desktop lists do. */
function HoverRow({ onPress, children }: { onPress: () => void; children: ReactNode }) {
  const { colors, radii } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.row,
        {
          borderRadius: radii.md,
          backgroundColor: hovered ? colors.surfaceMuted : "transparent",
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      {children}
    </Pressable>
  );
}

function FooterLink({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors, typography } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.footerLink,
        { opacity: pressed ? 0.6 : hovered ? 0.85 : 1 },
      ]}
    >
      {({ hovered }: { hovered?: boolean }) => (
        <Text
          style={[
            typography.caption,
            { color: colors.textSecondary, textDecorationLine: hovered ? "underline" : "none" },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

function IconButton({ glyph, label, onPress }: { glyph: string; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.iconButton,
        { backgroundColor: hovered ? colors.surfaceMuted : "transparent", opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <Text style={[styles.glyph, { color: colors.textSecondary }]}>{glyph}</Text>
    </Pressable>
  );
}

/**
 * The seven days as toggles. Hiding a day is presentation only — its classes
 * stay, and are still reminded about and exported — and the last shown day
 * cannot be hidden, which the store refuses anyway.
 */
function WeekdayChips({ value, onChange }: { value: Weekday[]; onChange: (days: Weekday[]) => void }) {
  const { colors, typography, borderWidth } = useTheme();
  const { format } = useI18n();

  function toggle(day: Weekday) {
    const next = value.includes(day) ? value.filter((d) => d !== day) : [...value, day];
    if (next.length === 0) return;
    onChange(ALL_WEEKDAYS_MONDAY_FIRST.filter((d) => next.includes(d)));
  }

  return (
    <View style={styles.chips}>
      {ALL_WEEKDAYS_MONDAY_FIRST.map((day) => {
        const on = value.includes(day);
        const last = on && value.length === 1;
        return (
          <Pressable
            key={day}
            onPress={() => toggle(day)}
            disabled={last}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on, disabled: last }}
            accessibilityLabel={format.weekdayLong(day)}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.chip,
              {
                borderWidth: borderWidth.thin,
                borderColor: on ? colors.accent : colors.dividerStrong,
                backgroundColor: on ? colors.accentSubtle : hovered ? colors.surfaceMuted : "transparent",
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text
              style={[
                typography.caption,
                { color: on ? colors.accentStrong : colors.textSecondary, fontWeight: on ? "600" : "400" },
              ]}
            >
              {format.weekdayNarrow(day)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  sidebar: {
    width: DESKTOP_SIDEBAR_WIDTH,
    flexGrow: 0,
    flexShrink: 0,
  },
  monthHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  monthTitle: {
    flex: 1,
    paddingLeft: 4,
    fontWeight: "600",
  },
  cardTitle: {
    textTransform: "uppercase",
    letterSpacing: 0.8,
    fontWeight: "600",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 8,
    marginHorizontal: -8,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginVertical: -6,
  },
  chevron: {
    fontSize: 20,
    marginLeft: 8,
  },
  iconButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  glyph: {
    fontSize: 18,
    lineHeight: 20,
  },
  chips: {
    flexDirection: "row",
    gap: 4,
  },
  chip: {
    flex: 1,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  footer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  footerLink: {
    paddingVertical: 4,
  },
});
