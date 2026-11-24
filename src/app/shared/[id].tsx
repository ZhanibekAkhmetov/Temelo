import { useLocalSearchParams } from "expo-router";

import { SharedLinkScreen } from "@/features/timetables/SharedLinkScreen";

/** A share link: `<web app>/shared/<id>`. See `SharedLinkScreen`. */
export default function SharedLinkRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SharedLinkScreen id={typeof id === "string" ? id : ""} />;
}
