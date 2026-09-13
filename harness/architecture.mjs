/**
 * Properties of source files rather than of data.
 *
 * Everything else in the harness imports a module and exercises it. This suite
 * reads files, because what it guards is not a rule about timetables — it is a
 * rule about what a particular file is allowed to contain, and the thing it is
 * guarding against is a *regression of design* rather than of behaviour.
 *
 * There is exactly one such rule today, and it is the one the incoming-share
 * feature was rebuilt around: **the share receiver does not navigate.** Every
 * previous attempt failed on a navigation dispatched into a navigator that was
 * not ready to receive it, and the fix was not to time the dispatch better but
 * to have none — so the receiver imports no router at all. That is a property a
 * future edit could quietly undo in one line, with the failure only showing up
 * on a physical phone, on a cold share, sometimes. So it is asserted here.
 *
 * Being explicit about the size of this proof, because it is small:
 *
 *  - It proves the dangerous *shape* is absent from the source, and fails the
 *    moment it is reintroduced.
 *  - It cannot prove anything about what React Navigation, Android or the Expo
 *    dev client do at runtime. Nothing running in Node can: there is no
 *    navigator here to observe, and no task stack. That half of the story is
 *    the device checklist, not this file.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { check, equal, section } from "./report.mjs";

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..", "src");

function read(...parts) {
  return readFileSync(join(SRC, ...parts), "utf8");
}

/**
 * The share receiver must have no router to call.
 *
 * Not "must not call one at the wrong moment" — must not have one. An overlay
 * that cannot navigate cannot dispatch an action into a `<Stack>` that has not
 * mounted, which is the whole of what went wrong before. The imported
 * timetable is seen by opening Temelo, like every other timetable.
 */
function testReceiverCannotNavigate() {
  section("Y. The share receiver has no navigation to get wrong");

  const source = read("features", "timetables", "ShareReceiver.tsx");

  check("the receiver was found", source.length > 0);
  check("it imports no router", !/from\s+["']expo-router["']/.test(source), "expo-router is imported");
  check("it dispatches no navigation", !/\brouter\s*\.\s*(push|replace|navigate|back|dismiss)/.test(source));
  check("it declares no route params", !/useLocalSearchParams|useGlobalSearchParams|useRouter\b/.test(source));

  /*
   * And it is not a route either. Anything under `src/app` is one — that is
   * Expo Router's whole contract — so a receiver that had drifted back into
   * being a screen would be found here rather than on a phone.
   */
  let isARoute = true;
  try {
    read("app", "share.tsx");
  } catch {
    isARoute = false;
  }
  check("the receiver is not a screen under src/app", !isARoute);
}

/**
 * The launch path must stay the app's ordinary one.
 *
 * `+native-intent.ts` is the only thing standing between `expo-sharing`'s
 * fabricated `temelo://expo-sharing` link and Expo Router trying to route to
 * it. If it stops existing, or starts answering with a path of its own, a
 * shared file goes back to producing an unmatched route — or worse, to landing
 * the user on a screen with no stack beneath it.
 */
function testNativeIntentStaysBoring() {
  section("Z. The native-intent hook still refuses to invent a destination");

  const source = read("app", "+native-intent.ts");

  // Expo Router finds this by filename — `./+native-intent.[tj]sx?` in the app
  // root — so reading it at all is half the assertion.
  check("it exports the hook Expo Router looks for", /export function redirectSystemPath\b/.test(source));
  check(
    "it answers with the shared decision rather than a path of its own",
    /incomingShareLaunchPath\(initial\)/.test(source),
  );
  check("a link it does not recognise is returned unchanged", /:\s*path\s*;/.test(source));
  // It runs before the first frame and must not throw; anything asynchronous
  // there would also delay every launch, shared or not.
  check("it is synchronous", !/\basync\b/.test(source));
  // It must not grow into the feature. Reading the payload, previewing it, or
  // deciding anything about a timetable here would put a second idea of when a
  // share begins in front of the one the receiver already has.
  check("it knows nothing about timetables", !/timetableFile|importPipeline|Sharing\./.test(source));

  equal("and there is one decision, taken in one place", source.match(/incomingShareLaunchPath\(/g).length, 1);
}

export function runArchitectureHarness() {
  testReceiverCannotNavigate();
  testNativeIntentStaysBoring();
}
