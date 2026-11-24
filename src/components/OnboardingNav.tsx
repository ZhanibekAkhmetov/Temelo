import { StyleSheet, View } from "react-native";

import { Button } from "@/components/Button";
import { useI18n } from "@/i18n/I18nProvider";
import { useIsDesktop } from "@/theme/useIsDesktop";
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
  // A phone splits the width between the two buttons, where a thumb can reach
  // either. A desktop puts them at the trailing edge at their own width, the
  // way a desktop dialog's actions sit — never a button the width of a form.
  const isDesktop = useIsDesktop();
  const side = isDesktop ? styles.sideDesktop : styles.side;

  return (
    <View
      style={[
        styles.row,
        isDesktop && styles.rowDesktop,
        { marginTop: spacing.xl, marginBottom: spacing.sm, gap: spacing.sm },
      ]}
    >
      {onBack ? (
        <View style={side}>
          <Button label={t("common.back")} variant="secondary" onPress={onBack} />
        </View>
      ) : null}
      <View style={side}>
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
  rowDesktop: {
    justifyContent: "flex-end",
  },
  side: {
    flex: 1,
  },
  sideDesktop: {
    minWidth: 140,
  },
});
