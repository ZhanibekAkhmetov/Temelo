import { StyleSheet, View } from "react-native";

import { Button } from "@/components/Button";
import { useTheme } from "@/theme/useTheme";

interface OnboardingNavProps {
  onBack?: () => void;
  onContinue: () => void;
  continueLabel?: string;
}

export function OnboardingNav({ onBack, onContinue, continueLabel = "Continue" }: OnboardingNavProps) {
  const { spacing } = useTheme();

  return (
    <View style={[styles.row, { marginTop: spacing.lg, gap: spacing.sm }]}>
      {onBack ? (
        <View style={styles.side}>
          <Button label="Back" variant="secondary" onPress={onBack} />
        </View>
      ) : null}
      <View style={styles.side}>
        <Button label={continueLabel} variant="primary" onPress={onContinue} />
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
