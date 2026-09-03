import { useEffect, useRef, useState } from "react";
import { AppState as DeviceAppState } from "react-native";

import { todayIsoDate } from "@/domain/date";
import { syncClassReminders, type ReminderSyncInput } from "@/features/reminders/scheduler";
import { useAppState } from "@/state/AppStateContext";

/** How often the date is re-read, so the rolling window crosses midnight. */
const DAY_ROLL_CHECK_MS = 60_000;

/**
 * Draws nothing; keeps the scheduled reminders in step with the timetable.
 *
 * Every event the reminders have to react to — a class created, edited,
 * moved, resized or deleted, a changed recurrence, a changed term, a changed
 * reminder setting — is a change to the stored timetable, and every one of
 * them produces a new `AppState` object. So there is one trigger here rather
 * than a call at each of those sites: the places that edit the timetable
 * cannot forget to refresh, because they are not the ones doing it.
 *
 * The other two triggers are the ones state changes cannot cover: the first
 * run when the app starts (this effect's own mount), and coming back to the
 * foreground, where reminders may have been delivered — or missed — while
 * the app was not running.
 */
export function ClassReminderScheduler() {
  const { state } = useAppState();
  const [windowStart, setWindowStart] = useState(todayIsoDate);

  // What the foreground listener should re-send; it is registered once and
  // must not close over the timetable as it was at mount.
  const latestInput = useRef<ReminderSyncInput | null>(null);

  useEffect(() => {
    const input: ReminderSyncInput = {
      placements: state.placements,
      courses: state.courses,
      exceptions: state.exceptions,
      timeSlots: state.timeSlots,
      fromDate: windowStart,
    };
    latestInput.current = input;
    syncClassReminders(input);
  }, [state, windowStart]);

  useEffect(() => {
    const subscription = DeviceAppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      const today = todayIsoDate();
      setWindowStart(today);
      // Not left to the state change above: the window may not have moved,
      // and a return to the foreground is a refresh in its own right.
      if (latestInput.current) syncClassReminders({ ...latestInput.current, fromDate: today });
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
