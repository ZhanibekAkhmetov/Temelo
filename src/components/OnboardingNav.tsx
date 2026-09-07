import { StyleSheet, View } from "react-native";

import { Button } from "@/components/Button";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/useTheme";

interface OnboardingNavProps {
  onBack?: () => void;
  onContinue: () => void;
  /** Defaults to "Continue"; screens that finish a flow pass their own. */
  continueLabel?: string;
  /**
   * Greys out the forward action while the form cannot be committed. The
   * reason belongs beside the field that is wrong; this only stops the tap
   * that would silently do nothing.
   */
  continueDisabled?: boolean;
}

export function OnboardingNav({ onBack, onContinue, continueLabel, continueDisabled }: OnboardingNavProps) {
  const { spacing } = useTheme();
  const { t } = useI18n();

  return (
    <View style={[styles.row, { marginTop: spacing.xl, marginBottom: spacing.sm, gap: spacing.sm }]}>
      {onBack ? (
        <View style={styles.side}>
          <Button label={t("common.back")} variant="secondary" onPress={onBack} />
        </View>
      ) : null}
      <View style={styles.side}>
        <Button
          label={continueLabel ?? t("common.continue")}
          variant="primary"
          onPress={onContinue}
          disabled={continueDisabled}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
  },
  side: {
    flex: 1,
  },
});
