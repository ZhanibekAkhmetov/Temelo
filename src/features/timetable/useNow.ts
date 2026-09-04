import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { todayIsoDate } from "@/domain/date";
import { nowHHmm } from "@/domain/time";

const TICK_INTERVAL_MS = 30_000;

export interface NowMoment {
  /** Local calendar date, ISO — which column counts as today. */
  date: string;
  /** Local wall-clock time, HH:mm — where in the day the marker sits. */
  time: string;
}

function readNow(): NowMoment {
  return { date: todayIsoDate(), time: nowHHmm() };
}

/**
 * The current moment, as React state.
 *
 * The date belongs here as much as the time does, and it has to come through
 * state rather than from a bare `todayIsoDate()` call in a component body.
 * With the React Compiler enabled — this app turns it on — such a call has no
 * reactive inputs, so it is hoisted into the component's memo cache and
 * evaluated exactly once per mount. Everything derived from it then freezes:
 * which column is today, which week the pager is anchored on, and therefore
 * whether the current-time marker is drawn at all. It would only right itself
 * when the screen was mounted again, which in practice means restarting the
 * app. Reading it from state gives the compiler a dependency to track.
 *
 * Same object identity between readings that change nothing, so a tick that
 * changes nothing costs no re-render.
 */
export function useNow(): NowMoment {
  const [moment, setMoment] = useState(readNow);

  useEffect(() => {
    const refresh = () =>
      setMoment((current) => {
        const next = readNow();
        return next.date === current.date && next.time === current.time ? current : next;
      });

    const timer = setInterval(refresh, TICK_INTERVAL_MS);
    // JavaScript timers do not run while the app is backgrounded, so what a
    // return to the foreground needs is a reading now, not the remainder of
    // an interval that was frozen mid-count — which is also the moment a
    // whole day may have passed since the last one.
    const subscription = AppState.addEventListener("change", (status) => {
      if (status === "active") refresh();
    });

    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);

  return moment;
}
