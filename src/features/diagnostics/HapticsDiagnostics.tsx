import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { useTheme } from "@/theme/useTheme";
import { getHapticsDiagnostics, probeHaptic, type HapticKind } from "@/util/haptics";

/**
 * Development-only panel that says whether haptics are actually reaching
 * the device. It exists because a silent failure here looks identical to
 * "the effect is too subtle to feel", and the usual cause — a development
 * build made before expo-haptics was installed — is only visible in the
 * error text of a real call.
 *
 * All expo-haptics access stays behind util/haptics; this only renders what
 * that module reports.
 */
export function HapticsDiagnostics() {
  const { colors, spacing, typography, radii, borderWidth } = useTheme();
  const [lastResult, setLastResult] = useState<string | null>(null);

  const diagnostics = getHapticsDiagnostics();

  async function test(kind: HapticKind) {
    const result = await probeHaptic(kind);
    setLastResult(result.ok ? `${kind}: request accepted` : `${kind}: ${result.error ?? "failed"}`);
  }

  return (
    <View
      style={[
        styles.panel,
        { borderColor: colors.border, borderWidth: borderWidth.thin, borderRadius: radii.sm, padding: spacing.md },
      ]}
    >
      <Text style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.xs }]}>
        Haptics diagnostics (development only)
      </Text>

      <Row label="JS module resolved" value={diagnostics.moduleResolved ? "yes" : "no"} />
      <Row label="Platform" value={diagnostics.platform} />
      <Row label="Android effects" value={`${diagnostics.androidEffects.selection} / ${diagnostics.androidEffects.activation}`} />
      <Row label="Requests accepted" value={String(diagnostics.successCount)} />
      <Row label="Last error" value={diagnostics.lastError ?? "none"} />
      {lastResult ? <Row label="Last test" value={lastResult} /> : null}

      <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
        <Button label="Test selection tick" variant="secondary" onPress={() => void test("selection")} />
        <Button label="Test long-press activation" variant="secondary" onPress={() => void test("activation")} />
      </View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const { colors, typography } = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[typography.caption, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[typography.caption, styles.value, { color: colors.textPrimary }]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    width: "100%",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 2,
  },
  value: {
    flexShrink: 1,
    textAlign: "right",
  },
});
