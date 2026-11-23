import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";

import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DateField } from "@/components/DateField";
import { DatePickerSheet } from "@/components/DatePickerSheet";
import { FormSection, NavigationRow } from "@/components/FormSection";
import { ScreenContainer } from "@/components/ScreenContainer";
import { ScreenHeader } from "@/components/ScreenHeader";
import { TextField } from "@/components/TextField";
import { todayIsoDate } from "@/domain/date";
import type { DomainError } from "@/domain/errors";
import { weekdaysWithClasses } from "@/domain/timetable";
import type { Weekday } from "@/domain/week";
import { CalendarExportSheet } from "@/features/timetables/CalendarExportSheet";
import { daysLabel, hoursLabel, shapeOfActive } from "@/features/timetables/summary";
import { TimetableActionSheet } from "@/features/timetables/TimetableActionSheet";
import { useExportCalendar, useShareTimetable } from "@/features/timetables/transfer";
import { VisibleWeekdaysField } from "@/features/timetables/VisibleWeekdaysField";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppState } from "@/state/AppStateContext";
import { MAX_TIMETABLE_NAME_LENGTH } from "@/storage/timetableLifecycle";
import { useTheme } from "@/theme/useTheme";

/**
 * The current timetable.
 *
 * Its name, when it starts, which days it shows, a way into the academic day,
 * and Archive. Nothing else — no id, no created date, no class count. Those
 * are facts about a database row, and this screen is about a timetable.
 *
 * The start date commits on Done, the way the days-shown choice commits on
 * tap. Moving it later hides the classes before it and deletes nothing — the
 * sheet says so in those words — so there is nothing to confirm twice.
 *
 * The name is editable in place and saved with the header's Save, because a
 * rename is a one-field form and a row that opened a second screen to change
 * one string would be a screen too many. Archive is a button below the fields
 * and behind a confirmation, because it is the one action here with a
 * consequence, and the confirmation has to say what the consequence actually
 * is — which is much less alarming than the word "archive" sounds, and saying
 * so is the point. The confirmation is Temelo's own `ConfirmDialog`, not the
 * platform alert.
 */
export default function CurrentTimetableScreen() {
  const { colors, spacing, typography, borderWidth } = useTheme();
  const { t, format } = useI18n();
  const { state, renameActiveTimetable, setTimetableStartDate, archiveCurrentTimetable, setVisibleWeekdays } = useAppState();
  /*
   * Share and Export are here as well as behind the long press on the
   * Timetables list, because a shortcut nobody finds is not a feature. This is
   * the screen a user reaches by tapping their timetable, so it is where they
   * will look.
   */
  const sharing = useShareTimetable();
  const calendar = useExportCalendar();

  const { timetable } = state;
  const [name, setName] = useState(timetable?.name ?? "");
  const [nameError, setNameError] = useState<DomainError | undefined>();
  const [busy, setBusy] = useState(false);
  const [startSheetOpen, setStartSheetOpen] = useState(false);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  /** The Share / Export chooser, and the calendar range sheet it can open. */
  const [transferOpen, setTransferOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  /** Why the last archive did not happen, shown beside the button that tried. */
  const [archiveError, setArchiveError] = useState<DomainError | undefined>();
  /**
   * A new set of days that would hide some that still have classes, waiting
   * for the user to confirm. `hidden` is just those days, to name them.
   */
  const [hideDays, setHideDays] = useState<{ next: Weekday[]; hidden: Weekday[] } | null>(null);

  /*
   * Archiving from this very screen is what removes the active timetable, and
   * the screen it leaves behind would have nothing to show. So it is dismissed
   * on the way out and this branch only ever renders for the frame between the
   * state change and the navigation.
   */
  if (!timetable) {
    return (
      <ScreenContainer
        header={
          <ScreenHeader
            title={t("timetables.detailsTitle")}
            onBack={() => router.back()}
            accessibilityBackLabel={t("common.back")}
          />
        }
      >
        <Text style={[typography.body, { color: colors.textSecondary, marginTop: spacing.lg }]}>
          {t("timetables.noCurrent")}
        </Text>
      </ScreenContainer>
    );
  }

  const shape = shapeOfActive(state.settings.visibleWeekdays, state.timeSlots);
  const hours = hoursLabel(t, shape);
  // Read out here rather than inside the handler: narrowing a `const` does not
  // reach into a hoisted function declaration, and an assertion would be a
  // worse answer than a name.
  const currentName = timetable.name;

  function handleSave() {
    const result = renameActiveTimetable({ name });
    if (!result.ok) {
      setNameError(result.error);
      return;
    }
    router.back();
  }

  /*
   * Hiding a day that has classes on it is allowed — it is only presentation,
   * and the classes, their reminders and their calendar export stay exactly as
   * they are — but it makes them disappear from the grid, which is easy to
   * mistake for having lost them. So that one case asks first and says so.
   */
  function handleVisibleWeekdays(next: Weekday[]) {
    const occupied = weekdaysWithClasses(state);
    const hidden = state.settings.visibleWeekdays.filter((day) => !next.includes(day) && occupied.has(day));
    if (hidden.length > 0) {
      setHideDays({ next, hidden });
      return;
    }
    setVisibleWeekdays({ visibleWeekdays: next });
  }

  function handleArchive() {
    setArchiveConfirmOpen(false);
    setArchiveError(undefined);
    setBusy(true);
    void archiveCurrentTimetable().then((result) => {
      setBusy(false);
      if (!result.ok) {
        // The timetable is still active and intact — the swap is atomic — so
        // the user stays here, with the reason next to the button.
        setArchiveError(result.error);
        return;
      }
      /*
       * Back to the Timetables screen rather than all the way out: the
       * timetable is now in the Archived list right there, which is the only
       * reassurance that matters after pressing Archive.
       */
      router.back();
    });
  }

  return (
    <View style={{ flex: 1 }}>
    <ScreenContainer
      header={
        <ScreenHeader
          title={t("timetables.detailsTitle")}
          onBack={() => router.back()}
          accessibilityBackLabel={t("common.back")}
          action={{ label: t("common.save"), onPress: handleSave, emphasis: true }}
        />
      }
    >
      <FormSection>
        <TextField
          label={t("timetables.name")}
          value={name}
          onChangeText={(next) => {
            setName(next);
            setNameError(undefined);
          }}
          placeholder={t("onboarding.timetableNamePlaceholder")}
          error={nameError ? t(nameError.key, nameError.params) : undefined}
          maxLength={MAX_TIMETABLE_NAME_LENGTH}
        />
        <DateField
          label={t("timetables.startsOn")}
          value={timetable.anchorDate}
          onPress={() => setStartSheetOpen(true)}
        />
        {/* Which days this timetable shows is edited here and only here —
            any set of the seven, at least one. The value is the days shown
            ("Mon–Fri", "Mon, Wed, Fri"), so the label says that too. */}
        <VisibleWeekdaysField
          label={t("timetables.days")}
          value={state.settings.visibleWeekdays}
          onChange={handleVisibleWeekdays}
        />
        {/* A whole form, so a row that opens one — and it says what it holds,
            so this screen answers the question without being opened. */}
        <NavigationRow
          label={t("timetables.academicDay")}
          value={hours ?? undefined}
          onPress={() => router.push("/timetables/academic-day")}
        />
      </FormSection>

      {/* Above the divider, not below it: neither sending a copy nor exporting
          one changes anything about the timetable, and grouping them with
          Archive would put harmless actions in the section reserved for the one
          with a consequence.

          One button rather than two. There are now two ways a timetable can
          leave the app and they are easy to confuse, so the choice — and the
          sentence explaining each — belongs in a sheet where there is room to
          say it, not in two buttons whose labels would have to carry it. */}
      <View style={{ marginTop: spacing.lg }}>
        <Button
          label={t("transfer.shareOrExport")}
          variant="secondary"
          onPress={() => setTransferOpen(true)}
          disabled={busy || sharing.sharing || calendar.exporting}
        />
        {sharing.error ? (
          <Text style={[typography.caption, { color: colors.danger, marginTop: spacing.sm }]}>
            {t(sharing.error.key, sharing.error.params)}
          </Text>
        ) : null}
      </View>

      <View
        style={{
          marginTop: spacing.xl,
          borderTopWidth: borderWidth.thin,
          borderColor: colors.divider,
          paddingTop: spacing.lg,
        }}
      >
        {/* Set apart by the divider above it, but not painted as a
            deletion. Archiving keeps every class and is undone by Restore —
            the confirmation below deliberately says so in those words, and a
            `danger`-filled button contradicted it before the dialog ever
            opened. `destructive` is reserved here for what cannot be taken
            back: Delete permanently, and Delete all data. */}
        <Button
          label={t("timetables.archiveAction")}
          variant="secondary"
          onPress={() => setArchiveConfirmOpen(true)}
          disabled={busy}
        />
        {archiveError ? (
          <Text style={[typography.caption, { color: colors.danger, marginTop: spacing.sm }]}>
            {t(archiveError.key, archiveError.params)}
          </Text>
        ) : null}
      </View>

      <View style={{ height: spacing.xl }} />
    </ScreenContainer>

      {/* Not destructive in tone: archiving deletes nothing and is undone by
          Restore, and the dialog's job is to say exactly that. */}
      {archiveConfirmOpen ? (
        <ConfirmDialog
          title={t("timetables.archiveTitle", { name: currentName })}
          message={t("timetables.archiveMessage")}
          confirmLabel={t("timetables.archiveConfirm")}
          onConfirm={handleArchive}
          onCancel={() => setArchiveConfirmOpen(false)}
        />
      ) : null}

      {hideDays ? (
        <ConfirmDialog
          title={t("week.hideDaysTitle")}
          message={t("week.hideDaysMessage", { days: daysLabel(t, format, hideDays.hidden) })}
          confirmLabel={t("week.hideDaysConfirm")}
          onConfirm={() => {
            setVisibleWeekdays({ visibleWeekdays: hideDays.next });
            setHideDays(null);
          }}
          onCancel={() => setHideDays(null)}
        />
      ) : null}

      {transferOpen ? (
        <TimetableActionSheet
          name={currentName}
          actions={[
            {
              key: "share",
              label: t("transfer.shareFileAction"),
              description: t("transfer.shareFileHint"),
              onPress: () => {
                setTransferOpen(false);
                sharing.shareActive();
              },
            },
            {
              key: "calendar",
              label: t("calendarExport.action"),
              description: t("calendarExport.actionHint"),
              onPress: () => {
                setTransferOpen(false);
                setCalendarOpen(true);
              },
            },
          ]}
          onDismiss={() => setTransferOpen(false)}
        />
      ) : null}

      {calendarOpen ? (
        <CalendarExportSheet
          name={currentName}
          anchorDate={timetable.anchorDate}
          // The active timetable is one the user is living in, so the suggested
          // range starts today rather than in weeks they have already sat.
          today={todayIsoDate()}
          busy={calendar.exporting}
          onExport={calendar.exportActive}
          onDismiss={() => setCalendarOpen(false)}
        />
      ) : null}

      {startSheetOpen ? (
        <DatePickerSheet
          title={t("timetables.startDateTitle")}
          value={timetable.anchorDate}
          note={t("timetables.startDateNote")}
          onCancel={() => setStartSheetOpen(false)}
          onConfirm={(startDate) => {
            setStartSheetOpen(false);
            setTimetableStartDate({ startDate });
          }}
        />
      ) : null}
    </View>
  );
}
