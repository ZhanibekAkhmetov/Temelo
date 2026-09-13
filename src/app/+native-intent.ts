import { incomingShareLaunchPath, isIncomingShareLink } from "@/domain/incomingShare";

/**
 * Where a link from outside the app goes.
 *
 * Expo Router calls this for every deep link before it tries to turn it into a
 * route — once on a cold launch with `initial: true`, and again for every link
 * that arrives while the app is running. Exactly one link reaching it is not a
 * route at all: `temelo://expo-sharing`, the sentinel `expo-sharing` fabricates
 * for an `ACTION_SEND` so that a navigation library has something to react to.
 * A send carries its file in an intent extra, not in a URI, so without that
 * sentinel there would be nothing for a router to see — and with it there is a
 * deep link to a route that does not exist. Left alone it resolves to the
 * generated `+not-found` screen. That is the unmatched-route error this feature
 * used to produce on every single share.
 *
 * The answer is to navigate nowhere special: a cold launch goes where any
 * launch goes, and a warm one goes nowhere at all. See
 * `incomingShareLaunchPath` for why each, and `domain/incomingShare` for the
 * whole of the reasoning.
 *
 * ## What this deliberately does not do
 *
 * It does not read the file, take the payload, or tell anything that a share
 * has arrived. It could — the sentinel is the earliest possible notice — and it
 * would be a worse design: the payload lives natively and is still there a
 * moment later, `features/timetables/ShareReceiver` asks for it directly, and
 * handing a second component a second idea of when a share began is how two
 * previews of the same file get drawn. This function's whole job is to stop a
 * navigation from happening.
 *
 * Two lines, and synchronous, because Expo Router documents this as a function
 * that must not throw: it runs before the first frame, so a failure here is not
 * a wrong route — it is a launch that never happens. `isIncomingShareLink` is
 * total, and everything it does not recognise is passed through untouched.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  return isIncomingShareLink(path) ? incomingShareLaunchPath(initial) : path;
}
