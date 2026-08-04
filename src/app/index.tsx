import { Redirect } from "expo-router";

import { useAppState } from "@/state/AppStateContext";

export default function Index() {
  const { state } = useAppState();
  return <Redirect href={state.settings.onboardingCompleted ? "/timetable" : "/onboarding/week"} />;
}
