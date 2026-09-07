import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { EDIT_SCOPE_ORDER, type EditScope } from "@/domain/classEdit";
import type { DomainError } from "@/domain/errors";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/translate";
import { useTheme } from "@/theme/useTheme";

interface EditScopeSheetProps {
  /** The date the edit lands on, named in the first option's explanation. */
  effectiveDate: string;
  /** Why a single-occurrence change cannot be offered, or null when it can. */
  onlyThisBlockedReason: DomainError | null;
  onSelect: (scope: EditScope) => void;
  onCancel: () => void;
}

/**
 * The three options' wording, as keys rather than sentences.
 *
 * Defined here rather than in the domain now that they are translation keys:
 * the domain owns what a scope *means* and which are offered, and this sheet
 * owns how each is put to the user.
 */
const SCOPE_LABEL_KEY: Record<EditScope, TranslationKey> = {
  onlyThis: "scopeChooser.onlyThis",
  thisAndFuture: "scopeChooser.thisAndFuture",
  all: "scopeChooser.all",
};

const SCOPE_HINT_KEY: Record<EditScope, TranslationKey> = {
  onlyThis: "scopeChooser.onlyThisHint",
  thisAndFuture: "scopeChooser.thisAndFutureHint",
  all: "scopeChooser.allHint",
};

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
  const { t, format } = useI18n();
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

  function explanationFor(scope: EditScope): string {
    return t(SCOPE_HINT_KEY[scope], { date: format.dateLong(effectiveDate) });
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable
          style={[styles.scrim, { backgroundColor: colors.scrim }]}
          onPress={dismiss}
          accessibilityRole="button"
          accessibilityLabel={t("common.cancel")}
        />

        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surfaceElevated,
              borderTopWidth: borderWidth.thin,
              borderColor: colors.divider,
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
            {t("scopeChooser.title")}
          </Text>

          <View style={{ borderTopWidth: borderWidth.thin, borderColor: colors.divider }}>
            {EDIT_SCOPE_ORDER.map((scope) => {
              const blocked = scope === "onlyThis" ? onlyThisBlockedReason : null;
              const blockedText = blocked ? t(blocked.key, blocked.params) : null;
              const disabled = blocked !== null || committing;
              const label = t(SCOPE_LABEL_KEY[scope]);
              return (
                <Pressable
                  key={scope}
                  onPress={() => choose(scope)}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  accessibilityHint={blockedText ?? explanationFor(scope)}
                  accessibilityState={{ disabled }}
                  pressRetentionOffset={{ top: 12, bottom: 12, left: 16, right: 16 }}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      paddingHorizontal: spacing.lg,
                      paddingVertical: spacing.md,
                      borderBottomWidth: borderWidth.thin,
                      borderColor: colors.divider,
                      backgroundColor: pressed && !disabled ? colors.surfaceMuted : "transparent",
                      opacity: blocked ? 0.55 : 1,
                    },
                  ]}
                >
                  {/* No line limits on either line. "Diesen und alle folgenden"
                      and its explanation are a third longer than the English,
                      and a row that grows is better than one that clips. */}
                  <Text style={[typography.body, { color: blocked ? colors.textMuted : colors.textPrimary }]}>
                    {label}
                  </Text>
                  <Text style={[typography.caption, { color: colors.textMuted, marginTop: 2 }]}>
                    {blockedText ?? explanationFor(scope)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            onPress={dismiss}
            disabled={committing}
            accessibilityRole="button"
            accessibilityLabel={t("common.cancel")}
            hitSlop={8}
            pressRetentionOffset={{ top: 16, bottom: 16, left: 24, right: 24 }}
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
            <Text style={[typography.label, { color: colors.textSecondary }]}>{t("common.cancel")}</Text>
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
  },
  sheet: {
    width: "100%",
  },
  row: {
    justifyContent: "center",
    minHeight: 56,
  },
  cancel: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
});
