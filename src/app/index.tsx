import { Redirect } from "expo-router";

import { useAppState } from "@/state/AppStateContext";

/**
 * Where a launch lands.
 *
 * Two questions, in this order:
 *
 *  - Has this app ever been set up? If not, straight into creating the first
 *    timetable. `onboardingCompleted` answers that and is never cleared, so it
 *    keeps answering it after the user has archived everything.
 *  - Otherwise, the timetable. Including when there is no *active* timetable:
 *    the grid screen draws its own empty state, which offers both creating one
 *    and going to the archived ones. Redirecting into setup instead would take
 *    the decision away from a user who archived their timetable on purpose and
 *    meant to restore a different one.
 */
export default function Index() {
  const { state } = useAppState();
  if (!state.settings.onboardingCompleted) return <Redirect href="/timetables/new-timetable" />;
  return <Redirect href="/timetable" />;
}
