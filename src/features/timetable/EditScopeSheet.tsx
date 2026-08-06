import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { formatIsoLong } from "@/domain/calendar";
import { EDIT_SCOPE_LABEL, EDIT_SCOPE_ORDER, type EditScope } from "@/domain/classEdit";
import { useTheme } from "@/theme/useTheme";

interface EditScopeSheetProps {
  /** The date the edit lands on, named in the first option's explanation. */
  effectiveDate: string;
  /** Why a single-occurrence change cannot be offered, or null when it can. */
  onlyThisBlockedReason: string | null;
  onSelect: (scope: EditScope) => void;
  onCancel: () => void;
}

function explanationFor(scope: EditScope, effectiveDate: string): string {
  if (scope === "onlyThis") return `Changes ${formatIsoLong(effectiveDate)} only; the rest of the series stays as it is.`;
  if (scope === "thisAndFuture") return "Splits the series here — earlier occurrences keep their current details.";
  return "Updates every occurrence of this class, past and future.";
}

/**
 * The one question an edit to a repeating class cannot avoid.
 *
 * Three quiet rows rather than three buttons: they are choices about the
 * same edit, not three separate actions, and the explanation under each is
 * doing more work than its label. Nothing has been written yet when this
 * opens — dismissing it leaves the timetable exactly as it was.
 */
export function EditScopeSheet({ effectiveDate, onlyThisBlockedReason, onSelect, onCancel }: EditScopeSheetProps) {
  const { colors, spacing, radii, typography, borderWidth } = useTheme();
  // A choice takes a frame or two to settle; a second tap in that window
  // would apply the same edit twice, at two different scopes.
  const [committing, setCommitting] = useState(false);

  function choose(scope: EditScope) {
    if (committing) return;
    setCommitting(true);
    onSelect(scope);
  }

  function dismiss() {
    if (committing) return;
    onCancel();
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable style={styles.scrim} onPress={dismiss} accessibilityRole="button" accessibilityLabel="Cancel" />

        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              borderTopWidth: borderWidth.thin,
              borderColor: colors.border,
              paddingBottom: spacing.xl,
            },
          ]}
        >
          <Text
            style={[
              typography.subtitle,
              { color: colors.textPrimary, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md },
            ]}
          >
            Apply changes to
          </Text>

          <View style={{ borderTopWidth: borderWidth.thin, borderColor: colors.border }}>
            {EDIT_SCOPE_ORDER.map((scope) => {
              const blocked = scope === "onlyThis" ? onlyThisBlockedReason : null;
              const disabled = blocked !== null || committing;
              return (
                <Pressable
                  key={scope}
                  onPress={() => choose(scope)}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel={EDIT_SCOPE_LABEL[scope]}
                  accessibilityHint={blocked ?? explanationFor(scope, effectiveDate)}
                  accessibilityState={{ disabled }}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      paddingHorizontal: spacing.lg,
                      paddingVertical: spacing.md,
                      borderBottomWidth: borderWidth.thin,
                      borderColor: colors.border,
                      backgroundColor: pressed && !disabled ? colors.surfaceAlt : "transparent",
                      opacity: blocked ? 0.55 : 1,
                    },
                  ]}
                >
                  <Text style={[typography.body, { color: blocked ? colors.textMuted : colors.textPrimary }]}>
                    {EDIT_SCOPE_LABEL[scope]}
                  </Text>
                  <Text style={[typography.caption, { color: colors.textMuted, marginTop: 2 }]}>
                    {blocked ?? explanationFor(scope, effectiveDate)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            onPress={dismiss}
            disabled={committing}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            style={({ pressed }) => [
              styles.cancel,
              {
                marginTop: spacing.md,
                marginHorizontal: spacing.lg,
                paddingVertical: spacing.sm,
                borderRadius: radii.sm,
                opacity: committing ? 0.5 : pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text style={[typography.label, { color: colors.textSecondary }]}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
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
    backgroundColor: "#00000059",
  },
  sheet: {
    width: "100%",
  },
  row: {
    justifyContent: "center",
  },
  cancel: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 40,
  },
});
