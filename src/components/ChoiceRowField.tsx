import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { ChoiceRow } from "@/components/ChoiceRow";
import { FieldRow, FieldValue } from "@/components/FieldRow";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/useTheme";

interface Choice<T extends string> {
  value: T;
  label: string;
}

interface ChoiceRowFieldProps<T extends string> {
  label: string;
  value: T;
  options: Choice<T>[];
  onChange: (value: T) => void;
  /** Heading of the sheet the row opens; defaults to the row's own label. */
  sheetTitle?: string;
  helperText?: string;
}

/**
 * A setting shown as one row — label on the left, current value on the right —
 * that opens a list to change it.
 *
 * This is the answer to a choice with four options and long labels. Forcing
 * "System", "English", "Русский" and "Deutsch" into a four-way segmented
 * control would leave each segment about a fifth of the screen wide, which
 * truncates three of the four on a normal phone; a list gives every option a
 * full line whatever the language, and reads as a settings row rather than as
 * a cramped toggle.
 *
 * There is no draft and no Save. The list commits on tap and closes, because
 * the effect of the choice — the whole app in another language, or another
 * scheme — is visible immediately and is its own confirmation.
 */
export function ChoiceRowField<T extends string>({
  label,
  value,
  options,
  onChange,
  sheetTitle,
  helperText,
}: ChoiceRowFieldProps<T>) {
  const { colors, spacing, radii, typography, borderWidth } = useTheme();
  const { t } = useI18n();
  const [isOpen, setOpen] = useState(false);

  const current = options.find((option) => option.value === value);
  const valueText = current?.label ?? value;

  function choose(next: T) {
    setOpen(false);
    onChange(next);
  }

  return (
    <FieldRow
      label={label}
      onPress={() => setOpen(true)}
      accessibilityLabel={`${label}, ${valueText}`}
      helperText={helperText}
      panel={
        <Modal visible={isOpen} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <View style={[styles.scrim, { backgroundColor: colors.overlay, padding: spacing.lg }]}>
            {/* Dismiss-on-tap sits behind the card rather than around it, so it
                never competes with the list for the touch responder. */}
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setOpen(false)}
              accessibilityLabel={t("common.close")}
            />

            <View
              style={[
                styles.card,
                {
                  backgroundColor: colors.surfaceElevated,
                  borderColor: colors.divider,
                  borderWidth: borderWidth.thin,
                  borderRadius: radii.lg,
                  padding: spacing.lg,
                },
              ]}
            >
              <Text style={[typography.subtitle, { color: colors.textPrimary, marginBottom: spacing.md }]}>
                {sheetTitle ?? label}
              </Text>

              <View accessibilityRole="radiogroup" accessibilityLabel={label}>
                {options.map((option) => (
                  <ChoiceRow
                    key={option.value}
                    label={option.label}
                    selected={option.value === value}
                    onPress={() => choose(option.value)}
                  />
                ))}
              </View>
            </View>
          </View>
        </Modal>
      }
    >
      <FieldValue>{valueText}</FieldValue>
    </FieldRow>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    width: "100%",
    maxWidth: 340,
  },
});
