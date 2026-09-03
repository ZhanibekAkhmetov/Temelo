/**
 * The single place the app talks to expo-notifications.
 *
 * Everything above this module deals in plain reminder plans; everything
 * below it is the OS. Keeping the boundary here is what lets the scheduling
 * rules be plain functions with no native dependency, and it means a failing
 * native call has exactly one place to be caught, recorded and reported —
 * which matters, because the usual cause of a total silence here is a
 * development build made before expo-notifications was installed, and that
 * is only visible in the error text of a real call.
 *
 * Two deliberate choices live in this file:
 *
 *  - Every notification carries our own identifier, built from the reminder
 *    key. Scheduling the same key twice therefore replaces rather than
 *    duplicates, even if two refreshes overlap.
 *  - Nothing here throws at the caller. A reminder that cannot be delivered
 *    must never be able to stop a class from being saved.
 */

import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import type { PlannedReminder } from "@/domain/reminderSchedule";

/**
 * Android channel these reminders are posted on.
 *
 * Versioned, and the version is part of the id. A channel's behaviour is
 * fixed when it is created: Android ignores every later change an app makes
 * to importance, sound or vibration, so that the user's own adjustments can
 * never be overridden. The first version of this channel was created without
 * vibration, and no amount of re-declaring it can add any — the only way to
 * ship different behaviour is to ship a different channel.
 *
 * Bumping this suffix is therefore the *only* correct way to change how these
 * notifications behave, and anything the user changed on the old channel is
 * deliberately not carried over: it was a preference about a channel that no
 * longer exists.
 */
export const REMINDER_CHANNEL_ID = "class-reminders-v2";

/** Channels this app has used before, cleared out so they stop lingering. */
const RETIRED_CHANNEL_IDS = ["class-reminders"];

/**
 * One short pulse: no delay, then 250 ms of vibration. Long enough to be
 * felt in a pocket, short enough not to read as an alarm — a reminder is a
 * nudge, and there is no sound alongside it to soften a longer buzz.
 */
const REMINDER_VIBRATION_PATTERN = [0, 250];

/** Marks a notification as ours, so a refresh never touches anything else. */
const REMINDER_DATA_KIND = "temelo.classReminder";

/** Our notifications' identifiers all start with this. */
const IDENTIFIER_PREFIX = "temelo-reminder:";

export type ReminderPermission = "granted" | "denied" | "undetermined" | "unavailable";

/**
 * A reminder is shown while Temelo is open, but never with a sound: it is a
 * nudge about the next class, not an alert, and the user is already looking
 * at the app. `shouldShowBanner`/`shouldShowList` are what present it
 * visually on iOS; Android presentation follows the channel.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

let lastError: string | null = null;
let channelReady = false;
const loggedErrors = new Set<string>();

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function recordError(context: string, error: unknown): void {
  const message = `${context}: ${messageFor(error)}`;
  lastError = message;
  if (__DEV__ && !loggedErrors.has(message)) {
    loggedErrors.add(message);
    console.warn(
      `[notifications] ${message}. If this says the native module is missing, the development build predates expo-notifications and needs rebuilding.`,
    );
  }
}

export function identifierFor(key: string): string {
  return `${IDENTIFIER_PREFIX}${key}`;
}

/**
 * The channel class reminders are posted on.
 *
 * `HIGH` importance so a reminder can surface as a heads-up while the user is
 * doing something else — that is the whole point of a reminder. Silent, and
 * felt rather than heard: no sound at all, and one short vibration, which is
 * what a class reminder should be in a room where a ringtone would not be
 * welcome. `HIGH` normally brings a sound with it; `sound: null` is what
 * takes it away without giving up the heads-up.
 *
 * These values are only the channel's *initial* behaviour. From the moment it
 * exists the user's own settings win, and nothing here tries to talk Android
 * out of that — no DND bypass, no full-screen intent.
 */
export async function ensureReminderChannelAsync(): Promise<void> {
  if (Platform.OS !== "android" || channelReady) return;
  try {
    await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
      name: "Class reminders",
      description: "Silent reminders with a short vibration before a class starts.",
      importance: Notifications.AndroidImportance.HIGH,
      sound: null,
      enableVibrate: true,
      vibrationPattern: REMINDER_VIBRATION_PATTERN,
      enableLights: false,
      showBadge: false,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
    channelReady = true;

    // A superseded channel would otherwise sit in the system notification
    // settings for good, under the same name as the live one and doing
    // nothing. Deleting it is safe precisely because its replacement has a
    // different id, so no user setting is being reset by the removal.
    for (const retired of RETIRED_CHANNEL_IDS) {
      await Notifications.deleteNotificationChannelAsync(retired);
    }
  } catch (error) {
    recordError("channel", error);
  }
}

export async function getReminderPermissionAsync(): Promise<ReminderPermission> {
  try {
    const settings = await Notifications.getPermissionsAsync();
    if (settings.granted) return "granted";
    return settings.canAskAgain ? "undetermined" : "denied";
  } catch (error) {
    recordError("permission-read", error);
    return "unavailable";
  }
}

/**
 * Asks for permission. Called only when a reminder actually needs to be
 * delivered and the answer is not already known, so the prompt appears once,
 * at the point it means something, rather than at launch.
 */
export async function requestReminderPermissionAsync(): Promise<ReminderPermission> {
  try {
    const settings = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: false, allowSound: false },
    });
    if (settings.granted) return "granted";
    return settings.canAskAgain ? "undetermined" : "denied";
  } catch (error) {
    recordError("permission-request", error);
    return "unavailable";
  }
}

/** What one of our notifications says about itself, read back from its data. */
export interface ReminderMark {
  key: string;
  fingerprint: string;
  /** The moment it was scheduled for; part of what makes it that reminder. */
  remindAt: number;
  /**
   * The channel it was queued against. Recorded because a notification
   * scheduled before the channel was versioned would still deliver on the
   * old one — silently and without vibration — and its content alone gives
   * no sign of that.
   */
  channelId: string;
}

export interface ScheduledReminder extends ReminderMark {
  identifier: string;
}

function readReminderData(data: unknown): ReminderMark | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  if (record.kind !== REMINDER_DATA_KIND) return null;
  if (typeof record.key !== "string" || typeof record.fingerprint !== "string") return null;
  if (typeof record.remindAt !== "number") return null;
  return {
    key: record.key,
    fingerprint: record.fingerprint,
    remindAt: record.remindAt,
    // Anything scheduled before the channel was recorded predates the
    // current one by definition.
    channelId: typeof record.channelId === "string" ? record.channelId : "",
  };
}

/**
 * Our pending notifications only. Anything else the app might schedule one
 * day is left alone, so "cancel what is obsolete" can never mean "cancel
 * everything".
 */
export async function getScheduledRemindersAsync(): Promise<ScheduledReminder[]> {
  try {
    const requests = await Notifications.getAllScheduledNotificationsAsync();
    return requests.flatMap((request) => {
      const data = readReminderData(request.content.data);
      if (!data) return [];
      return [{ identifier: request.identifier, ...data }];
    });
  } catch (error) {
    recordError("read-scheduled", error);
    return [];
  }
}

/**
 * Reminders already sitting in the notification tray.
 *
 * This is how a reminder delivered while the app was closed is recognised as
 * already handled: the OS fired it, so it is no longer scheduled, but it is
 * still presented — and presenting it a second time on the next launch would
 * be a duplicate.
 */
export async function getPresentedRemindersAsync(): Promise<ReminderMark[]> {
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    return presented.flatMap((notification) => {
      const data = readReminderData(notification.request.content.data);
      return data ? [data] : [];
    });
  } catch (error) {
    recordError("read-presented", error);
    return [];
  }
}

function contentFor(reminder: PlannedReminder): Notifications.NotificationContentInput {
  return {
    title: reminder.title,
    body: reminder.body,
    // Silent on both platforms: iOS from the content, Android from the
    // channel, which ignores this.
    sound: false,
    // Android 8 and later take the pattern from the channel and ignore this
    // one; below that there are no channels, and this is the only place a
    // vibration can be asked for at all.
    vibrate: REMINDER_VIBRATION_PATTERN,
    data: {
      kind: REMINDER_DATA_KIND,
      key: reminder.key,
      fingerprint: reminder.fingerprint,
      channelId: REMINDER_CHANNEL_ID,
      placementId: reminder.placementId,
      occurrenceDate: reminder.occurrenceDate,
      courseId: reminder.courseId,
      date: reminder.date,
      remindAt: reminder.remindAt,
    },
  };
}

/** Hands one reminder to the OS for its own moment. Returns whether it took. */
export async function scheduleReminderAsync(reminder: PlannedReminder): Promise<boolean> {
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: identifierFor(reminder.key),
      content: contentFor(reminder),
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(reminder.remindAt),
        channelId: REMINDER_CHANNEL_ID,
      },
    });
    return true;
  } catch (error) {
    recordError("schedule", error);
    return false;
  }
}

/**
 * Shows a reminder straight away — the case where its moment passed while
 * the app was not running, but the class has not started yet.
 */
export async function presentReminderNowAsync(reminder: PlannedReminder): Promise<boolean> {
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: identifierFor(reminder.key),
      content: contentFor(reminder),
      trigger: null,
    });
    return true;
  } catch (error) {
    recordError("present", error);
    return false;
  }
}

export async function cancelReminderAsync(identifier: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(identifier);
  } catch (error) {
    recordError("cancel", error);
  }
}

export interface NotificationsDiagnostics {
  moduleResolved: boolean;
  platform: string;
  channelReady: boolean;
  /** Which channel version reminders are being posted on. */
  channelId: string;
  lastError: string | null;
}

export function getNotificationsDiagnostics(): NotificationsDiagnostics {
  return {
    moduleResolved: typeof Notifications?.scheduleNotificationAsync === "function",
    platform: Platform.OS,
    channelReady: Platform.OS === "android" ? channelReady : true,
    channelId: REMINDER_CHANNEL_ID,
    lastError,
  };
}
