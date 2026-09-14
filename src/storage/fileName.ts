/**
 * Turning a timetable's name into a filename somebody would recognise in a
 * Downloads folder.
 *
 * Extracted from `storage/timetableFile`, where it was written for `.temelo`,
 * because the calendar exporter needs exactly the same answer and two
 * sanitizers would be two sets of rules about what a filesystem accepts. It is
 * deliberately the *only* thing shared between the two file formats: neither
 * knows anything else about the other.
 *
 * Nothing here knows what a timetable is. It takes a string a user typed and
 * returns a string that is safe to create a file with, and the caller composes
 * the rest of the name and the extension.
 */

/**
 * Characters no filename may carry.
 *
 * The union of what Android, Windows and the share targets in between object
 * to. `/` and `\` are the two that matter for safety rather than tidiness:
 * without them a timetable named `../x` would be a path rather than a name.
 * Control characters are handled separately, just below.
 */
const UNSAFE_FILE_NAME = /[<>:"/\|?*]/g;

/**
 * Whether a code point has no business being in a filename at all.
 *
 * Everything below U+0020 plus DEL. Checked by code point rather than with a
 * control-character class in the regex above, which would need an eslint
 * exemption and would put two literal control characters into the source of a
 * file that is otherwise all prose.
 */
function isControlPoint(point: string): boolean {
  const code = point.codePointAt(0) ?? 0;
  return code < 0x20 || code === 0x7f;
}

/**
 * A name, reduced to something that can safely be part of a filename.
 *
 * "My timetable" stays `My timetable`. Spaces are kept, because this is a
 * document rather than an identifier and a user looking for their timetable is
 * looking for its name. Everything a filesystem or a share target could object
 * to is removed, runs of whitespace collapse to one space, and leading and
 * trailing dots and spaces go — a name that is only dots is the classic way to
 * produce `.` or `..`.
 *
 * `maxPoints` is counted in code points, not UTF-16 units, so a Cyrillic or
 * German name is not truncated harder than an English one.
 *
 * Returns the empty string when nothing survives. That is not a failure, and
 * it is deliberately not papered over here: what a nameless file should be
 * called differs per format, so each caller supplies its own fallback.
 */
export function sanitizeFileNameStem(name: string, maxPoints: number): string {
  const cleaned = [...name]
    // A space rather than nothing: a name with a newline in the middle of it is
    // two words, and joining them into one would be a worse answer than the
    // space the rest of this function is already collapsing.
    .map((point) => (isControlPoint(point) ? " " : point))
    .join("")
    .replace(UNSAFE_FILE_NAME, " ")
    .replace(/\s+/g, " ")
    /*
     * Dots and spaces at either end, in one pass each.
     *
     * Trailing dots are stripped by some filesystems and kept by others, which
     * is worse than either, and leading ones hide the file. The character class
     * includes whitespace so that the two cannot hide behind each other: with
     * separate trim-then-strip-dots steps, "../../x" arrives here as ".. .. x"
     * and leaves as ".. x", still leading with a dot.
     */
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "");

  const points = [...cleaned];
  if (points.length <= maxPoints) return cleaned;
  // Trimmed again: a cut that lands mid-word can leave a trailing space, and a
  // filename ending in one is the same problem the pass above just solved.
  return points.slice(0, maxPoints).join("").replace(/[.\s]+$/, "");
}
