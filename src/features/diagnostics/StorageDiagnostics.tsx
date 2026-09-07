import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { deviceLocalesAvailable, deviceLocalesError } from "@/i18n/deviceLocales";
import { useAppState } from "@/state/AppStateContext";
import type { StorageReport } from "@/storage/diagnostics";
import { useTheme } from "@/theme/useTheme";

/**
 * Development-only panel showing whether the database is actually saving.
 *
 * It exists because of a real failure that took a device session to find: a
 * database written by another build reported a schema version whose columns it
 * did not have, every read succeeded, every write failed, and the app looked
 * perfectly healthy until it was killed. Nothing on screen could have told the
 * difference — the only signal was one `console.warn` among the noise.
 *
 * So this reports the two things that disagreed. The claimed schema version,
 * and the columns the tables really have. When those two disagree, "missing"
 * is non-empty and every write naming one of those columns is failing right
 * now.
 *
 * The device locale line is here rather than in a panel of its own because it
 * answers the same kind of question: whether a native module this build
 * depends on is actually in the binary.
 */
export function StorageDiagnostics() {
  const { colors, spacing, typography, radii, borderWidth } = useTheme();
  const { storageError, persistence, readStorageReport } = useAppState();
  const [report, setReport] = useState<StorageReport | null>(null);

  async function refresh() {
    setReport(await readStorageReport());
  }

  /*
   * One read on mount, so the panel says something without being prodded.
   *
   * Run once and only once: `readStorageReport` is rebuilt with the context
   * value on every state change, so listing it as a dependency would re-read
   * the database on every keystroke and every drag.
   */
  useEffect(() => {
    let cancelled = false;
    readStorageReport().then(
      (next) => {
        if (!cancelled) setReport(next);
      },
      (error: unknown) => {
        console.warn("[temelo/storage] could not read the schema report", error);
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const healthy = report !== null && report.missingColumns.length === 0;
  const writesFailing = persistence.lastWriteOk === false;

  return (
    <View
      style={[
        styles.panel,
        { borderColor: colors.divider, borderWidth: borderWidth.thin, borderRadius: radii.sm, padding: spacing.md },
      ]}
    >
      <Text style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.xs }]}>
        Storage diagnostics (development only)
      </Text>

      {/* The two lines worth seeing first, coloured so a failure cannot be
          skimmed past. */}
      <Row
        label="Writes"
        value={
          persistence.lastWriteOk === null
            ? "none attempted yet"
            : writesFailing
              ? `FAILING — ${persistence.failureCount} of ${persistence.writeCount}`
              : `ok (${persistence.writeCount} this launch)`
        }
        tone={writesFailing ? "bad" : persistence.lastWriteOk === true ? "good" : "plain"}
      />
      <Row
        label="Schema"
        value={report === null ? "…" : healthy ? "complete" : `MISSING ${report.missingColumns.join(", ")}`}
        tone={report === null ? "plain" : healthy ? "good" : "bad"}
      />

      <Row label="Open error" value={storageError ?? "none"} tone={storageError ? "bad" : "plain"} />
      <Row label="Last write error" value={persistence.lastError ?? "none"} tone={persistence.lastError ? "bad" : "plain"} />

      <Row label="Database" value={report?.databaseName ?? "…"} />
      <Row
        label="user_version"
        value={report === null ? "…" : `${report.schemaVersion} (this build targets ${report.targetSchemaVersion})`}
      />
      <Row label="Initialized" value={report?.initializedAt ?? "never"} />
      <Row
        label="Repaired at open"
        value={report === null ? "…" : report.repairedColumns.length === 0 ? "nothing" : report.repairedColumns.join(", ")}
      />
      <Row label="settings columns" value={report?.settingsColumns.join(", ") ?? "…"} />
      <Row label="exception columns" value={report?.occurrenceExceptionColumns.join(", ") ?? "…"} />
      <Row
        label="Row counts"
        value={
          report === null
            ? "…"
            : Object.entries(report.counts)
                .map(([table, count]) => `${table} ${count}`)
                .join(" · ")
        }
      />
      <Row
        label="Device locales"
        value={deviceLocalesAvailable ? "available" : `UNAVAILABLE — ${deviceLocalesError ?? "unknown"}`}
        tone={deviceLocalesAvailable ? "plain" : "bad"}
      />

      <View style={{ marginTop: spacing.sm }}>
        <Button label="Re-read database schema" variant="secondary" onPress={() => void refresh()} />
      </View>
    </View>
  );
}

function Row({ label, value, tone = "plain" }: { label: string; value: string; tone?: "plain" | "good" | "bad" }) {
  const { colors, typography } = useTheme();
  const color = tone === "bad" ? colors.danger : tone === "good" ? colors.accentStrong : colors.textPrimary;

  return (
    <View style={styles.row}>
      <Text style={[typography.caption, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[typography.caption, styles.value, { color }]} numberOfLines={4}>
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
