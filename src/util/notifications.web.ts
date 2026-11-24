/**
 * The web build's version of `util/notifications`: there are no reminders in a
 * browser.
 *
 * `expo-notifications` supports Android and iOS only, and a browser tab cannot
 * deliver a notification at a time of its choosing without push — which would
 * need a server holding every user's schedule, the opposite of local-first.
 * So the web build says so, in the vocabulary the app already has: permission
 * is `"unavailable"`, the state the settings screen and the class editor
 * already explain, and nothing is ever scheduled. Reminder lead times are still
 * stored with each class, so a timetable carried to the phone app by a
 * `.temelo` file arrives with its reminders.
 *
 * Every export is typed against the native file (`typeof Native.*`), so the
 * two cannot drift apart; `tests/architecture.test.mjs` checks they export the
 * same names.
 */

import type * as Native from "@/util/notifications";

export type {
  NotificationsDiagnostics,
  ReminderChannelText,
  ReminderMark,
  ReminderPermission,
  ScheduledReminder,
} from "@/util/notifications";

/** Typed as the native literal, so a changed channel id fails to compile here. */
export const REMINDER_CHANNEL_ID: typeof Native.REMINDER_CHANNEL_ID = "class-reminders-v2";

export const identifierFor: typeof Native.identifierFor = (key) => `temelo-reminder:${key}`;

export const ensureReminderChannelAsync: typeof Native.ensureReminderChannelAsync = async () => {};

export const getReminderPermissionAsync: typeof Native.getReminderPermissionAsync = async () => "unavailable";

export const requestReminderPermissionAsync: typeof Native.requestReminderPermissionAsync = async () =>
  "unavailable";

export const getScheduledRemindersAsync: typeof Native.getScheduledRemindersAsync = async () => [];

export const getPresentedRemindersAsync: typeof Native.getPresentedRemindersAsync = async () => [];

export const scheduleReminderAsync: typeof Native.scheduleReminderAsync = async () => false;

export const presentReminderNowAsync: typeof Native.presentReminderNowAsync = async () => false;

export const cancelReminderAsync: typeof Native.cancelReminderAsync = async () => {};

export const getNotificationsDiagnostics: typeof Native.getNotificationsDiagnostics = () => ({
  moduleResolved: false,
  platform: "web",
  channelReady: true,
  channelId: REMINDER_CHANNEL_ID,
  lastError: null,
});
