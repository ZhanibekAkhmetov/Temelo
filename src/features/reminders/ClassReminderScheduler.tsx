import { useEffect, useMemo, useRef, useState } from "react";
import { AppState as DeviceAppState } from "react-native";

import { todayIsoDate } from "@/domain/date";
import type { ReminderTextFormat } from "@/domain/reminderSchedule";
import { syncClassReminders, type ReminderSyncInput } from "@/features/reminders/scheduler";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppState } from "@/state/AppStateContext";

/** How often the date is re-read, so the rolling window crosses midnight. */
const DAY_ROLL_CHECK_MS = 60_000;

/**
 * Draws nothing; keeps the scheduled reminders in step with the timetable.
 *
 * Every event the reminders have to react to — a class created, edited,
 * moved, resized or deleted, a changed recurrence, a changed reminder setting,
 * a timetable archived or restored — is a change to the stored timetable, and
 * every one of them produces a new `AppState` object. So there is one trigger
 * here rather than a call at each of those sites: the places that edit the
 * timetable cannot forget to refresh, because they are not the ones doing it.
 *
 * That is what makes archiving need no reminder code of its own. An archived
 * timetable's placements are no longer in `state`, so the next refresh plans
 * nothing for them and cancels what the OS was still holding; a restore puts
 * them back and the same refresh schedules them from the restored data. Only
 * the active timetable is ever the input, because only the active timetable is
 * ever in state.
 *
 * The other three triggers are the ones state changes cannot cover: the first
 * run when the app starts (this effect's own mount), coming back to the
 * foreground, where reminders may have been delivered — or missed — while the
 * app was not running, and a change of language, which changes the words a
 * pending reminder will show.
 */
export function ClassReminderScheduler() {
  const { state } = useAppState();
  const { t, format, language } = useI18n();
  const [windowStart, setWindowStart] = useState(todayIsoDate);

  // Rebuilt only when the language actually changes, so an ordinary edit
  // hands the scheduler the same functions it had before.
  const text = useMemo<ReminderTextFormat>(
    () => ({
      startsIn: (leadMinutes) => t("reminders.notificationStartsIn", { lead: format.leadTime(leadMinutes) }),
      room: (room) => t("reminders.notificationRoom", { room }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language],
  );

  const channelText = useMemo(
    () => ({ name: t("reminders.channelName"), description: t("reminders.channelDescription") }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language],
  );

  // What the foreground listener should re-send; it is registered once and
  // must not close over the timetable as it was at mount.
  const latestInput = useRef<ReminderSyncInput | null>(null);
  /*
   * Whether this effect has run before.
   *
   * Only the runs after the first one may raise the permission prompt. The
   * first run is the app opening — the timetable it reconciles is the one
   * that was already stored, so wanting to deliver a reminder says nothing
   * about what the user has just decided. Every later run is a change to
   * that timetable, which is to say something the user did: saving a class
   * with a reminder on it, or changing the default in Settings. That is the
   * moment the prompt means something, and it is the only moment it appears.
   */
  const hasSynced = useRef(false);

  useEffect(() => {
    const input: ReminderSyncInput = {
      placements: state.placements,
      courses: state.courses,
      exceptions: state.exceptions,
      timeSlots: state.timeSlots,
      timetableStart: state.timetable?.anchorDate ?? null,
      fromDate: windowStart,
      text,
      channelText,
      mayRequestPermission: hasSynced.current,
    };
    hasSynced.current = true;
    latestInput.current = input;
    syncClassReminders(input);
  }, [state, windowStart, text, channelText]);

  useEffect(() => {
    const subscription = DeviceAppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      const today = todayIsoDate();
      setWindowStart(today);
      // Not left to the state change above: the window may not have moved,
      // and a return to the foreground is a refresh in its own right. It is
      // not a decision about reminders, though, so it never asks.
      if (latestInput.current) {
        syncClassReminders({ ...latestInput.current, fromDate: today, mayRequestPermission: false });
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      const today = todayIsoDate();
      setWindowStart((current) => (current === today ? current : today));
    }, DAY_ROLL_CHECK_MS);
    return () => clearInterval(timer);
  }, []);

  return null;
}
