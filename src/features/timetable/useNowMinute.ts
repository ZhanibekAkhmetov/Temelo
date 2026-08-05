import { useEffect, useState } from "react";

import { nowHHmm } from "@/domain/time";

const TICK_INTERVAL_MS = 30_000;

/**
 * Local HH:mm, refreshed while the screen is mounted so the current-time
 * marker doesn't freeze at whatever minute the timetable happened to open.
 * Returns the same string between minutes, so a tick that changes nothing
 * costs no re-render.
 */
export function useNowMinute(): string {
  const [now, setNow] = useState(nowHHmm);

  useEffect(() => {
    const timer = setInterval(() => setNow(nowHHmm()), TICK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return now;
}
