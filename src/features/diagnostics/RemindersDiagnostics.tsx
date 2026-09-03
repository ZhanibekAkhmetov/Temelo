import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { REMINDER_WINDOW_DAYS, MAX_SCHEDULED_REMINDERS } from "@/domain/reminderSchedule";
import { resyncClassReminders } from "@/features/reminders/scheduler";
import { useReminderStatus } from "@/features/reminders/useReminderStatus";
import { useTheme } from "@/theme/useTheme";
import { getNotificationsDiagnostics, getScheduledRemindersAsync, type ScheduledReminder } from "@/util/notifications";

/** How many scheduled reminders the list shows before it stops. */
const LISTED_LIMIT = 12;

function formatMoment(ms: number | null): string {
  if (ms === null) return "never";
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Development-only panel showing what the OS has actually been told.
 *
 * Reminders are the one feature in this app whose success is invisible:
 * "nothing happened yet" and "nothing was ever scheduled" look identical
 * until the moment one of them is wrong. This reads the real scheduled
 * notifications back out rather than reporting what the app believes it did.
 */
export function RemindersDiagnostics() {
  const { colors, spacing, typography, radii, borderWidth } = useTheme();
  const status = useReminderStatus();
  const [listed, setListed] = useState<ScheduledReminder[] | null>(null);

  const diagnostics = getNotificationsDiagnostics();

  async function loadScheduled() {
    setListed(await getScheduledRemindersAsync());
  }

  return (
    <View
      style={[
        styles.panel,
        { borderColor: colors.border, borderWidth: borderWidth.thin, borderRadius: radii.sm, padding: spacing.md },
      ]}
    >
      <Text style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.xs }]}>
        Reminder diagnostics (development only)
      </Text>

      <Row label="JS module resolved" value={diagnostics.moduleResolved ? "yes" : "no"} />
      <Row label="Platform" value={diagnostics.platform} />
      <Row label="Android channel" value={`${diagnostics.channelId} · ${diagnostics.channelReady ? "ready" : "not set up"}`} />
      <Row label="Permission" value={status.permission} />
      <Row label="Window" value={`${REMINDER_WINDOW_DAYS} days, max ${MAX_SCHEDULED_REMINDERS}`} />
      <Row label="Planned (upcoming)" value={String(status.plannedCount)} />
      <Row label="Scheduled with OS" value={String(status.scheduledCount)} />
      <Row
        label="Last refresh"
        value={`${formatMoment(status.lastRunAt)} · +${status.lastScheduled} / −${status.lastCancelled} / now ${status.lastPresented}`}
      />
      <Row label="Last error" value={status.lastError ?? "none"} />

      <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
        <Button label="Refresh reminders now" variant="secondary" onPress={() => resyncClassReminders()} />
        <Button label="Read scheduled notifications" variant="secondary" onPress={() => void loadScheduled()} />
      </View>

      {listed ? (
        <View style={{ marginTop: spacing.sm }}>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            {listed.length} scheduled by Temelo
            {listed.length > LISTED_LIMIT ? `, first ${LISTED_LIMIT} shown` : ""}
          </Text>
          {listed
            .slice()
            .sort((a, b) => a.remindAt - b.remindAt)
            .slice(0, LISTED_LIMIT)
            .map((reminder) => (
              <Row key={reminder.identifier} label={formatMoment(reminder.remindAt)} value={reminder.key} />
            ))}
        </View>
      ) : null}
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
