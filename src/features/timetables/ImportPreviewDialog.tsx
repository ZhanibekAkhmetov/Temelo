import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/useTheme";
import { daysLabel, hoursLabel } from "@/features/timetables/summary";
import type { PendingImport } from "@/features/timetables/transfer";

interface ImportPreviewDialogProps {
  pending: PendingImport;
  /** True while the import is being written. Both buttons are held. */
  busy: boolean;
  /** Why the last attempt did not happen, already translated. */
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * What is in the file, before anything is written.
 *
 * ## Why there is a step here at all
 *
 * A `.temelo` arrives with no context: it came out of a chat, it is named
 * whatever the sender's phone called it, and its contents are a timetable the
 * user may never have seen. Importing straight off the picker would mean the
 * first thing they learn about the file is what it did. So this says what the
 * timetable *is* — its name, when it starts, which days it covers, what hours
 * its day runs, how many classes are in it — and what will happen to it, and
 * then asks.
 *
 * Nothing has been written when this is on screen. Cancel is not an undo; it is
 * a decision not to start, which is why it is a plain secondary button and
 * carries no warning.
 *
 * ## What it deliberately does not show
 *
 * No ids, no format versions, no JSON, no "34 records", no file path. Those are
 * facts about a document, and the user is being asked about a timetable. The
 * four rows below are the same four facts the archived-timetable screen shows
 * about a timetable nobody has opened, plus the class count — which that screen
 * pointedly leaves out and this one needs, because a file is the one timetable
 * somebody is being asked to accept sight unseen.
 *
 * ## Why the destination is a sentence and not a row
 *
 * "It will be added to your archived timetables. Your current timetable stays
 * as it is." is the answer to the question the user is actually asking, and it
 * is not a property of the timetable — it is a consequence of theirs. So it
 * reads as prose under the facts rather than as a fifth row pretending to be
 * one of them.
 */
export function ImportPreviewDialog({ pending, busy, error, onConfirm, onCancel }: ImportPreviewDialogProps) {
  const { colors, spacing, radii, typography, borderWidth } = useTheme();
  const { t, format } = useI18n();
  /*
   * There is no local "already pressed" latch here, deliberately.
   *
   * The other confirmations in the app keep one, because they are unmounted by
   * their caller on both outcomes and the latch dies with them. This dialog is
   * the exception: a write that did not land leaves the preview up with the
   * reason beside it, so the user can try again without finding the file a
   * second time — and a latch that is only released by unmounting would leave
   * both buttons dead on exactly that path. Guarding a second tap is therefore
   * `useImportTimetable`'s job, where the operation is; `busy` is the whole of
   * what this needs to know.
   */
  const held = busy;

  const hours = hoursLabel(t, pending.summary);

  function confirm() {
    if (held) return;
    onConfirm();
  }

  function cancel() {
    if (held) return;
    onCancel();
  }

  const facts: { key: string; label: string; value: string }[] = [
    { key: "startsOn", label: t("timetables.startsOn"), value: format.dateLong(pending.summary.startDate) },
    { key: "days", label: t("timetables.days"), value: daysLabel(t, format, pending.summary.weekendMode) },
    ...(hours ? [{ key: "academicDay", label: t("timetables.academicDay"), value: hours }] : []),
    { key: "classes", label: t("transfer.importClasses"), value: String(pending.summary.classCount) },
  ];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={cancel} statusBarTranslucent>
      <View style={[styles.root, { padding: spacing.xl }]}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
          onPress={cancel}
          accessibilityRole="button"
          accessibilityLabel={t("common.cancel")}
        />

        <View
          accessibilityViewIsModal
          style={[
            styles.card,
            {
              backgroundColor: colors.surfaceElevated,
              borderColor: colors.divider,
              borderWidth: borderWidth.thin,
              borderRadius: radii.lg,
              padding: spacing.lg,
              shadowColor: colors.shadow,
            },
          ]}
        >
          <Text style={[typography.caption, { color: colors.textMuted }]}>{t("transfer.importPreviewTitle")}</Text>

          {/* The name is the subject of the screen, so it is the largest thing
              on it — and it wraps rather than truncating, because a timetable a
              stranger named is exactly the name you cannot guess the end of. */}
          <Text
            accessibilityRole="header"
            numberOfLines={3}
            style={[typography.title, styles.name, { color: colors.textPrimary, marginTop: spacing.xs }]}
          >
            {pending.name}
          </Text>

          {/* Scrolls rather than grows: four rows always fit, but a large font
              scale plus a three-line name on a small phone does not, and a
              dialog whose buttons are off the bottom of the screen is worse
              than one that scrolls. */}
          <ScrollView
            style={{ marginTop: spacing.lg }}
            contentContainerStyle={{ paddingBottom: spacing.xs }}
            keyboardShouldPersistTaps="handled"
          >
            {facts.map((fact, index) => (
              <View
                key={fact.key}
                style={[
                  styles.fact,
                  {
                    paddingVertical: spacing.sm,
                    gap: spacing.md,
                    borderBottomWidth: index === facts.length - 1 ? 0 : borderWidth.thin,
                    borderColor: colors.divider,
                  },
                ]}
              >
                <Text style={[typography.body, { color: colors.textSecondary }]}>{fact.label}</Text>
                <Text style={[typography.body, styles.value, { color: colors.textPrimary }]}>{fact.value}</Text>
              </View>
            ))}
          </ScrollView>

          <Text style={[typography.caption, styles.destination, { color: colors.textMuted, marginTop: spacing.md }]}>
            {pending.destination === "archive" ? t("transfer.importAsArchive") : t("transfer.importAsActive")}
          </Text>

          {error ? (
            <Text style={[typography.caption, { color: colors.danger, marginTop: spacing.sm }]}>{error}</Text>
          ) : null}

          {/* Stacked rather than side by side: "Stundenplan importieren" next to
              "Abbrechen" in two half-width buttons wraps both to two lines, and
              the action here has a long name in every language. */}
          <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
            <Button
              label={t("transfer.importConfirm")}
              variant="primary"
              onPress={confirm}
              disabled={held}
            />
            <Button label={t("common.cancel")} variant="secondary" onPress={cancel} disabled={held} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    width: "100%",
    maxWidth: 420,
    // Leaves the dialog room to breathe on a tall phone while keeping it off
    // the status bar on a short one; the fact list scrolls inside it.
    maxHeight: "85%",
    elevation: 8,
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  name: {
    fontWeight: "700",
  },
  fact: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    minHeight: 32,
  },
  value: {
    fontWeight: "600",
    flexShrink: 1,
    textAlign: "right",
  },
  destination: {
    lineHeight: 18,
  },
});
