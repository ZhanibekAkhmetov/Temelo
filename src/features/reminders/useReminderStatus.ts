import { useSyncExternalStore } from "react";

import { getReminderStatus, subscribeToReminderStatus, type ReminderStatus } from "@/features/reminders/scheduler";

/**
 * Whether reminders can actually be delivered, for the screens that need to
 * say so. Deliberately not part of `AppState`: it is what the OS currently
 * permits, not something the app owns or stores.
 */
export function useReminderStatus(): ReminderStatus {
  return useSyncExternalStore(subscribeToReminderStatus, getReminderStatus, getReminderStatus);
}
