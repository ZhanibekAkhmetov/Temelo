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

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { check, equal, section } from "./report.mjs";

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..", "src");

function read(...parts) {
  return readFileSync(join(SRC, ...parts), "utf8");
}

/** Every TypeScript source file under `src`, as `{ path, source }`. */
function everySourceFile() {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) {
        files.push({ path: relative(SRC, full).replace(/\\/g, "/"), source: readFileSync(full, "utf8") });
      }
    }
  };
  walk(SRC);
  return files;
}

/**
 * The same text with its comments removed.
 *
 * The files this suite reads explain themselves at length, and several of the
 * words it searches for — "calendar", "ics", the name of a native module —
 * appear in that prose precisely *because* the rule is being justified there.
 * Asserting against the raw text would therefore fail on a well-documented file
 * and pass on an undocumented one, which is exactly backwards. So the
 * assertions below are about code, and this is what makes them so.
 */
function codeOf(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
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

/**
 * Every native file or intent module is reached through one file.
 *
 * The rule predates the calendar work — `expo-file-system` and `expo-sharing`
 * have always been `util/timetableFiles`'s alone — and adding a third such
 * module is exactly the moment to assert it rather than to keep meaning it.
 * `expo-intent-launcher` is the most tempting of the three to reach for
 * directly, because "open this file" reads like a one-liner from anywhere, and
 * the one-liner is what puts a `content://` URI and a permission grant into a
 * screen component.
 */
function testNativeEdgeStaysAtOneFile() {
  section("AA. The native file and intent modules are reached through one file");

  const BOUNDARY = "util/timetableFiles.ts";
  const NATIVE = ["expo-file-system", "expo-sharing", "expo-intent-launcher"];
  const files = everySourceFile();

  check("the source tree was walked", files.length > 20, `found ${files.length}`);

  for (const module of NATIVE) {
    // Both spellings, because the intent launcher is deliberately reached by a
    // deferred `require` — see `intentLauncher` — and a rule that only knew
    // about `import` would have a hole exactly where the newest module sits.
    const named = new RegExp(`(from\\s+["']|require\\(\\s*["']|import\\(\\s*["'])${module}(/[^"']*)?["']`);
    const importers = files.filter(({ source }) => named.test(codeOf(source))).map(({ path }) => path);
    equal(`${module} is reached from exactly one file`, importers.join(","), BOUNDARY);
  }

  /*
   * And the boundary still knows nothing about what it is carrying. It takes a
   * file name, some text and a MIME type; deciding that a calendar is
   * `text/calendar` belongs to `storage/calendarFile`, which is what keeps the
   * whole of the file *format* testable in Node with no native modules at all.
   */
  const boundary = codeOf(read("util", "timetableFiles.ts"));
  check("the boundary hard-codes no MIME type", !/["']text\/calendar["']|["']application\/octet-stream["']/.test(boundary));
  check("...names no file extension", !/["'][^"']*\.(ics|temelo)["']/.test(boundary));
  check("...and imports nothing from storage or domain", !/from\s+["']@\/(storage|domain|features)\//.test(boundary));
}

/**
 * Opening a file and sending a copy of it are two different Android verbs.
 *
 * This is the product decision the calendar hand-off turns on, and it is one
 * line of code away from being silently undone: swapping `openFileWithApp` back
 * to `shareTimetableFile` would still compile, still export a correct `.ics`,
 * and still look right in review — and calendar apps would stop being offered,
 * because they register no `ACTION_SEND` filter. So the shape is asserted.
 *
 * What this cannot prove is the runtime half — that Android resolves the intent
 * and that the grant lets the calendar read the file. Nothing in Node can; that
 * is the device checklist.
 */
function testOpeningAndSharingStaySeparate() {
  section("AB. Opening a file and sharing it stay two different things");

  const boundary = codeOf(read("util", "timetableFiles.ts"));

  check("there is an ACTION_VIEW launch", /["']android\.intent\.action\.VIEW["']/.test(boundary));
  check("it is the only intent action named", (boundary.match(/android\.intent\.action\.[A-Z_]+/g) ?? []).length === 1);
  check("it carries a read grant", /flags:\s*FLAG_GRANT_READ_URI_PERMISSION/.test(boundary));
  equal("which is Android's own constant", (boundary.match(/FLAG_GRANT_READ_URI_PERMISSION\s*=\s*0x0*1\b/g) ?? []).length, 1);
  check("it hands over a content URI", /data:\s*contentUri/.test(boundary));

  /*
   * The one thing the outbound path must never do, and the reason the grant
   * exists at all. Scoped to the function that hands a file *out*: reading a
   * `file://` somebody else sent in is a different question with a different
   * answer, and `isFileUri` rightly says yes to it.
   */
  const opening = boundary.slice(boundary.indexOf("export async function openFileWithApp"));
  const openingBody = opening.slice(0, opening.indexOf("\nexport ", 1) + 1 || undefined);
  check("the opening function was found", openingBody.includes("startActivityAsync"), "not found");
  check("it never hands out a file:// URI", !/file:\/\//.test(openingBody));
  check("...and never reads the plain file uri for the hand-off", !/\.uri\b/.test(openingBody));
  check("the share sheet is still reached the way it was", /Sharing\.shareAsync\(/.test(boundary));
  check("opening is refused off Android before anything is written", /Platform\.OS\s*!==\s*["']android["']/.test(boundary));

  /*
   * And above it: one build of the file, two ways out. If the serializer were
   * called once per delivery the two could drift, and "the calendar I opened"
   * and "the calendar I sent myself" would stop being the same file.
   */
  const transfer = codeOf(read("features", "timetables", "transfer.ts"));
  equal("the calendar is serialized exactly once", (transfer.match(/buildIcsCalendar\(/g) ?? []).length, 1);
  equal("...and resolved exactly once", (transfer.match(/calendarOccurrencesIn\(/g) ?? []).length, 1);
  check("opening goes to the intent launcher", /openFileWithApp\(/.test(transfer));
  check("sharing still goes to the share sheet", /shareTimetableFile\(/.test(transfer));
  check("an empty range is answered before either", /occurrences\.length === 0/.test(transfer));
  // A calendar app that cannot be found is its own answer, not a failure: the
  // sheet points at the other button instead of reporting an error.
  check("a missing calendar app is its own outcome", /kind:\s*["']noCalendarApp["']/.test(transfer));
}

export function runArchitectureHarness() {
  testReceiverCannotNavigate();
  testNativeIntentStaysBoring();
  testNativeEdgeStaysAtOneFile();
  testOpeningAndSharingStaySeparate();
}
