/**
 * The link Android hands the router when somebody shares a file into Temelo,
 * and the short memory of which shares have already been answered.
 *
 * Pure: no React, no native module, no knowledge of what a timetable is. The
 * payload itself never passes through here — it is parked natively by
 * `expo-sharing` and fetched by `util/timetableFiles`. What this module owns is
 * the *one* thing about an incoming share that the navigation layer touches,
 * and the reason it must be taken away from it.
 *
 * ## Why there is a link at all
 *
 * An `ACTION_SEND` has no URI. The file travels in `EXTRA_STREAM`, and a
 * navigation library watching for deep links would therefore see nothing at all
 * when one arrives. `expo-sharing` closes that gap by *fabricating* a link:
 * having stashed the real intent in a native singleton, it rewrites the
 * activity's intent to `ACTION_VIEW` of `temelo://expo-sharing` on a cold
 * launch, and emits the same URL as a `url` event on a warm one. (Both halves
 * are in `SharingReactActivityLifecycleListener`; the host is hard-coded there
 * and in the iOS source as `"$scheme://expo-sharing"`.)
 *
 * So Expo Router is handed a deep link to a route that does not exist, on every
 * single share, through the front door. Left alone it resolves to the generated
 * `+not-found` screen — which is the "unmatched route" the user sees, and which
 * is a *navigation* the app never asked for.
 *
 * `app/+native-intent.ts` is the documented place to intercept that, and it is
 * the only thing in the app that calls this module. The answer it gives is
 * deliberately the most boring one available: see `incomingShareLaunchPath`. A
 * shared file changes what is *drawn* — `features/timetables/ShareReceiver`
 * puts itself over the top of everything — and never where the app *is*.
 */

/**
 * The host `expo-sharing` puts on the link it fabricates for an incoming send.
 *
 * Not ours to choose. Named here rather than spelled inline at the one call
 * site, where a hard-coded string from somebody else's module would look like a
 * decision this app made.
 */
export const INCOMING_SHARE_HOST = "expo-sharing";

/**
 * Whether a deep link is `expo-sharing`'s fabricated one.
 *
 * Total, and deliberately so: this is reached from `redirectSystemPath`, which
 * Expo Router documents as a function that must not throw. It runs before the
 * first frame, so a failure here is not a wrong answer — it is a launch that
 * never happens. Every input that is not recognisably the sentinel is "no",
 * including inputs that are not strings at all.
 *
 * Matched on the host alone, across any scheme. The scheme is built from the
 * app's own (`temelo`), but a development build and a production build do not
 * always agree about what that is, and the host is the half `expo-sharing`
 * actually controls. Matched on the *whole* host rather than a prefix, so a
 * real route called `/expo-sharing-settings` could never be swallowed.
 */
export function isIncomingShareLink(url: unknown): boolean {
  if (typeof url !== "string" || url.length === 0) return false;

  const scheme = schemeOf(url);
  if (scheme === null) return false;

  const rest = url.slice(scheme.length + 1).replace(/^\/+/, "");
  return (rest.split(/[/?#]/, 1)[0] ?? "") === INCOMING_SHARE_HOST;
}

/**
 * The scheme of a URL, lowercased, or null if it does not have one.
 *
 * Hand-rolled rather than `new URL()`. This is on the launch path, where the
 * cost of being wrong is a crash rather than a wrong answer, and `new URL()`
 * throws on plenty of strings a system intent can carry. The grammar is RFC
 * 3986's and it is two lines.
 */
function schemeOf(url: string): string | null {
  const colon = url.indexOf(":");
  if (colon <= 0) return null;
  const scheme = url.slice(0, colon);
  return /^[A-Za-z][A-Za-z0-9+.-]*$/.test(scheme) ? scheme.toLowerCase() : null;
}

/**
 * Where a launch carrying a shared file should go: nowhere of its own.
 *
 * This is the whole of the routing decision for an incoming share, and both
 * halves of it are "act as though no link arrived":
 *
 *  - **A cold launch** (`initial`) goes to the app's ordinary entry path, which
 *    is exactly where a launcher tap goes. `app/index.tsx` then decides between
 *    the grid and first-time setup, as it does on every other launch. There is
 *    no second startup path, and nothing lands on a screen with an empty stack
 *    beneath it.
 *  - **A warm arrival** goes *nowhere at all*. Expo Router's link subscriber
 *    forwards a href only `if (href)`, so the empty string is how a
 *    `redirectSystemPath` declines to navigate. The user was in the middle of
 *    something; a file turning up is not a reason to move them, and it is what
 *    makes "cancelling leaves you where you were" true by there being nowhere
 *    to return from.
 *
 * The empty string must *not* be the cold answer: Expo Router reads a falsy
 * initial URL as "no initial state", and the navigator would then fall back to
 * its first registered route rather than to `index`.
 */
export function incomingShareLaunchPath(initial: boolean): string {
  return initial ? "/" : "";
}

/* ---------------------------------------------------------------- answered */

/**
 * A short memory of shares the user has already answered.
 *
 * Not a history, and not persistence. It exists for one Android behaviour: the
 * intent that started a task is *redelivered* when that task is resumed after
 * the process was reclaimed, so without this a user could be handed the same
 * preview they cancelled an hour earlier, for a file that is long gone from the
 * chat it came out of. Keyed on the URI, which is what identifies the payload.
 *
 * Bounded, so a long session cannot accumulate URIs forever. Insertion-ordered,
 * which is what makes the eviction below evict the oldest.
 */
export interface AnsweredShares {
  has: (uri: string) => boolean;
  /** Records that the user has seen this file and answered — imported *or* cancelled. */
  add: (uri: string) => void;
  /** Forgets everything. The harness uses it; the app never does. */
  clear: () => void;
}

/**
 * How many answered shares are remembered at once.
 *
 * Small on purpose — see above, this is not a history. A handful of entries
 * covers every real sequence of files a person shares in one sitting.
 */
export const ANSWERED_SHARE_MEMORY = 8;

/**
 * A factory rather than a module-level object, so the harness can make its own
 * and so two of them cannot see each other's state. The app uses exactly one.
 */
export function createAnsweredShares(memory: number = ANSWERED_SHARE_MEMORY): AnsweredShares {
  const answered = new Set<string>();

  return {
    has: (uri) => answered.has(uri),
    add(uri) {
      // Re-inserting moves it to the end, so a file answered twice is the
      // newest rather than the next to be forgotten.
      answered.delete(uri);
      answered.add(uri);
      while (answered.size > memory) {
        const oldest = answered.values().next();
        if (oldest.done) break;
        answered.delete(oldest.value);
      }
    },
    clear() {
      answered.clear();
    },
  };
}

/**
 * The app's memory of answered shares.
 *
 * A module singleton because it has to outlive the component that writes it:
 * the receiver is unmounted and remounted by nothing today, but the guarantee
 * this provides — "a file you have answered is not offered again" — must not
 * depend on that staying true. It holds URIs and nothing else, so it is not a
 * second copy of anything the database owns.
 */
export const answeredShares: AnsweredShares = createAnsweredShares();
