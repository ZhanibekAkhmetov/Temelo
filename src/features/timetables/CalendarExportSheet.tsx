import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { Button } from "@/components/Button";
import { DateField } from "@/components/DateField";
import { DatePickerSheet } from "@/components/DatePickerSheet";
import { FormSection } from "@/components/FormSection";
import {
  defaultCalendarExportRange,
  validateCalendarExportRange,
  type CalendarExportRange,
} from "@/domain/calendarExport";
import type { DomainError } from "@/domain/errors";
import { CAN_OPEN_IN_APP, type CalendarDelivery, type CalendarExportOutcome } from "@/features/timetables/transfer";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/useTheme";

interface CalendarExportSheetProps {
  /** The timetable being exported. Its name titles the sheet. */
  name: string;
  /** Its start date — `Timetable.anchorDate` — for the suggested range. */
  anchorDate: string;
  /** Today, for an active timetable; null for an archive. See the domain note. */
  today: string | null;
  /** True while an export is running, so the button can say so. */
  busy: boolean;
  /** Runs the export. Resolves to what happened; the sheet stays open for it. */
  onExport: (range: CalendarExportRange, how: CalendarDelivery) => Promise<CalendarExportOutcome>;
  onDismiss: () => void;
}

/**
 * Choosing the stretch of a timetable to hand to a calendar.
 *
 * ## Why there is a range at all
 *
 * A Temelo timetable has a start and deliberately no end, so "export it" has no
 * finite answer — a weekly class repeats until the user changes it. The two
 * dates are what turn the request into one, and they are the only thing this
 * sheet asks for. Everything else about the export is already decided: which
 * classes occur is the timetable's business, and what an `.ics` looks like is
 * the file format's.
 *
 * ## What it commits to
 *
 * Nothing, until Export. The two dates are a draft; dismissing the sheet throws
 * them away and the timetable is untouched either way, because exporting only
 * ever reads.
 *
 * The note under the dates says the file is a one-time copy. That is the single
 * most important thing a user can misunderstand here — a calendar that stopped
 * matching Temelo two months later would look like a bug rather than like the
 * nature of a file — so it is on screen before the export rather than in a help
 * page after it.
 *
 * ## Empty ranges
 *
 * A range with no classes in it is answered in place, as a message beside the
 * dates, and the sheet stays open on the dates that produced it. It is not an
 * error dialog and it is not a silently shared empty file: the user asked a
 * reasonable question about a summer holiday, and the useful response is the
 * answer plus the ability to change the dates without starting again.
 */
export function CalendarExportSheet({
  name,
  anchorDate,
  today,
  busy,
  onExport,
  onDismiss,
}: CalendarExportSheetProps) {
  const { colors, spacing, radii, typography, borderWidth } = useTheme();
  const { t } = useI18n();

  // Seeded once. Re-deriving it would fight the user every time they changed a
  // date, and the suggestion is only ever a starting point.
  const [range, setRange] = useState<CalendarExportRange>(() =>
    defaultCalendarExportRange({ anchorDate, today }),
  );
  const [picking, setPicking] = useState<"from" | "to" | null>(null);
  /** The last attempt's refusal, or null. Cleared by any change to the dates. */
  const [failure, setFailure] = useState<DomainError | null>(null);
  /** True when the last attempt found nothing in the range. */
  const [empty, setEmpty] = useState(false);
  /**
   * True once a direct open found no calendar app on this device.
   *
   * Kept until the sheet closes rather than until the dates change, because it
   * is a fact about the device and not about the range — changing the dates
   * will not conjure a calendar app, and clearing it would invite the user to
   * press a button that has already been answered.
   */
  const [noCalendarApp, setNoCalendarApp] = useState(false);

  // Live, so an impossible range is named as the user makes it rather than
  // when they press Export.
  const invalid = validateCalendarExportRange(range);
  const problem = invalid ?? failure;

  function change(next: CalendarExportRange) {
    setRange(next);
    setFailure(null);
    setEmpty(false);
  }

  function handleExport(how: CalendarDelivery) {
    setFailure(null);
    setEmpty(false);
    void onExport(range, how).then((outcome) => {
      switch (outcome.kind) {
        case "shared":
        case "opened":
          // The sheet has done its job and the share sheet — or the calendar —
          // is now over it; leaving it behind would be a screen the user has to
          // dismiss twice.
          onDismiss();
          return;
        case "noCalendarApp":
          // Stays open, deliberately: the answer is the other button, and it is
          // right here.
          setNoCalendarApp(true);
          return;
        case "empty":
          setEmpty(true);
          return;
        case "failed":
          setFailure(outcome.error);
          return;
        case "busy":
          // A second tap inside one frame. Nothing happened, and nothing to say.
          return;
      }
    });
  }

  /*
   * Back inside a native Modal arrives as `onRequestClose` and never as a
   * BackHandler event, so the date sheet cannot hear it for itself — see the
   * note in `DatePickerSheet`, and the same interception in `ClassEditorModal`.
   * An open picker is what Back closes first; only with none open does it close
   * this sheet. Without this, tapping Back to dismiss the calendar would throw
   * away the range as well.
   */
  function handleBack() {
    if (picking) {
      setPicking(null);
      return;
    }
    onDismiss();
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={handleBack} statusBarTranslucent>
      {/*
       * A plain view, exactly like every other transparent sheet in the app —
       * `TimetableActionSheet` and `EditScopeSheet` are the same three lines.
       * The gesture root this modal also needs is *not* here; see the note on
       * the date sheet below for why putting it here is what made the whole
       * window opaque.
       */}
      <View style={styles.root}>
        <Pressable
          style={[styles.scrim, { backgroundColor: colors.scrim }]}
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel={t("common.cancel")}
        />

        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surfaceElevated,
              borderTopWidth: borderWidth.thin,
              borderColor: colors.divider,
              borderTopLeftRadius: radii.lg,
              borderTopRightRadius: radii.lg,
              paddingHorizontal: spacing.lg,
              paddingBottom: spacing.xl,
            },
          ]}
        >
          <Text
            accessibilityRole="header"
            style={[typography.subtitle, { color: colors.textPrimary, paddingTop: spacing.lg }]}
          >
            {t("calendarExport.title")}
          </Text>
          <Text style={[typography.caption, { color: colors.textMuted, marginTop: spacing.xs }]} numberOfLines={2}>
            {name}
          </Text>

          <FormSection>
            <DateField
              label={t("calendarExport.from")}
              value={range.from}
              onPress={() => setPicking("from")}
            />
            <DateField label={t("calendarExport.to")} value={range.to} onPress={() => setPicking("to")} />
          </FormSection>

          <Text style={[typography.caption, { color: colors.textMuted, marginTop: spacing.md }]}>
            {t("calendarExport.note")}
          </Text>

          {/* One of the two, and only one: a range can be impossible or empty,
              never both, because an impossible one is refused before it is
              resolved.

              They are drawn differently on purpose. An impossible range is a
              mistake in the form and reads as one — plain danger-coloured text
              under the field that caused it. An empty range is not a mistake:
              the dates are valid and the answer is simply that nothing meets in
              them. So it gets a contained, accent-tinted status row instead of
              a red line — quiet enough not to read as a failure, contained
              enough not to be mistaken for the note above it, which is what it
              was when both were the same grey caption. It also has to carry its
              own explanation, because it is the reason Export is disabled and
              nothing else on screen would say so. */}
          {problem ? (
            <Text style={[typography.caption, { color: colors.danger, marginTop: spacing.sm }]}>
              {t(problem.key, problem.params)}
            </Text>
          ) : empty ? (
            <StatusRow
              title={t("errors.calendarNoClasses")}
              detail={t("calendarExport.emptyHint")}
              colors={colors}
              spacing={spacing}
              radii={radii}
              typography={typography}
              borderWidth={borderWidth}
            />
          ) : noCalendarApp ? (
            /* Same surface as the empty range, and for the same reason: valid
               input, an answer rather than a mistake, and a next step that is
               already on screen. */
            <StatusRow
              title={t("errors.calendarNoApp")}
              detail={t("calendarExport.noAppHint")}
              colors={colors}
              spacing={spacing}
              radii={radii}
              typography={typography}
              borderWidth={borderWidth}
            />
          ) : null}

          {/* Both buttons are disabled while the range is known to hold nothing,
              so the sheet does not offer a delivery that has already been
              answered. It is `empty` rather than a live count because the count
              is the resolver's answer about the whole timetable, which this
              sheet deliberately does not hold — and `change` clears it, so
              editing either date enables them again immediately.

              Two actions rather than one, on Android, because they are two
              different things and the old single button only ever did the
              second: opening hands the file to a calendar, sharing hands a copy
              to anything. Opening leads, because wanting these lessons in one's
              calendar is why anybody opens this sheet; sharing stays as the
              secondary, for Drive, a chat app, or another phone. On iOS there
              is one button and it shares — see `CAN_OPEN_IN_APP`. */}
          <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
            {CAN_OPEN_IN_APP ? (
              <>
                <Button
                  label={t("calendarExport.openInCalendar")}
                  variant="primary"
                  onPress={() => handleExport("open")}
                  disabled={busy || invalid !== null || empty || noCalendarApp}
                />
                <Button
                  label={t("calendarExport.shareFile")}
                  variant="secondary"
                  onPress={() => handleExport("share")}
                  disabled={busy || invalid !== null || empty}
                />
              </>
            ) : (
              <Button
                label={t("calendarExport.confirm")}
                variant="primary"
                onPress={() => handleExport("share")}
                disabled={busy || invalid !== null || empty}
              />
            )}
            <Button label={t("common.cancel")} variant="ghost" onPress={onDismiss} disabled={busy} />
          </View>
        </View>

        {/* Last child of the modal's own root, so it covers the whole sheet —
            the same arrangement every other screen that hosts one uses.

            ## Why the gesture root is here and not around the whole modal

            A React Native `Modal` is a separate native window, so nothing
            inside it descends from the `GestureHandlerRootView` in the root
            layout, and a Gesture Handler recogniser mounted in here is never
            handed the touches. The month pager's horizontal swipe is exactly
            such a recogniser, so one has to be in this window or only its
            arrows work.

            It wraps the date sheet alone, because on Android
            `GestureHandlerRootView` is a *native* view, and a native view as
            the direct child of a `transparent` modal makes that window opaque:
            the scrim and the sheet stop compositing and the whole screen turns
            black. Not immediately — it survives the first few openings and
            appears once the activity has been backgrounded and resumed a few
            times, which is precisely what "Open in calendar" does — so it is
            the kind of fault that reaches a release. The class editor gets
            away with the same wrapper only because its modal is opaque.

            Scoped here it costs nothing: the date sheet fills its parent
            absolutely and paints its own scrim over everything, so this
            wrapper is only ever on screen underneath it, and only while a date
            is actually being picked. */}
        {picking ? (
          <GestureHandlerRootView style={styles.pickerHost}>
            <DatePickerSheet
              title={picking === "from" ? t("calendarExport.fromTitle") : t("calendarExport.toTitle")}
              value={picking === "from" ? range.from : range.to}
              onCancel={() => setPicking(null)}
              onConfirm={(date) => {
                /*
                 * The date the user picked, exactly as they picked it. A "To"
                 * before "From" is left alone and named by the message above
                 * rather than silently corrected — moving a date somebody just
                 * chose is how a form stops being trustworthy.
                 */
                change(picking === "from" ? { ...range, from: date } : { ...range, to: date });
                setPicking(null);
              }}
            />
          </GestureHandlerRootView>
        ) : null}
      </View>
    </Modal>
  );
}

/**
 * A contained, accent-tinted line of information — not an error.
 *
 * The distinction it exists to draw: an impossible range is a mistake in the
 * form and is drawn as plain danger-coloured text under the fields, while an
 * empty range and a device with no calendar app are *answers*. Both are valid
 * input with an outcome the user did not expect, and both have a next step
 * already on screen, so they get a quiet contained surface with a heading and a
 * line saying what to do — enough hierarchy not to be missed, far short of an
 * alarm. The tokens are the ones the theme already pairs for this: an
 * `accentSubtle` ground with `accentStrong` ink.
 */
function StatusRow({
  title,
  detail,
  colors,
  spacing,
  radii,
  typography,
  borderWidth,
}: {
  title: string;
  detail: string;
} & Pick<ReturnType<typeof useTheme>, "colors" | "spacing" | "radii" | "typography" | "borderWidth">) {
  return (
    <View
      accessibilityRole="alert"
      style={{
        marginTop: spacing.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: radii.md,
        borderWidth: borderWidth.thin,
        borderColor: colors.divider,
        backgroundColor: colors.accentSubtle,
      }}
    >
      <Text style={[typography.label, { color: colors.accentStrong }]}>{title}</Text>
      <Text style={[typography.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}>{detail}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "flex-end",
  },
  scrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
  },
  /**
   * The gesture root around the date sheet.
   *
   * Absolute rather than `flex: 1`, because the date sheet it wraps is itself
   * absolutely positioned and would otherwise have nothing to fill: a wrapper
   * laid out normally here would collapse to no height, and the sheet inside it
   * would have no area to receive touches in.
   */
  pickerHost: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
