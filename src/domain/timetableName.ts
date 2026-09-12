/**
 * The name a timetable gets when the user does not give it one.
 *
 * Naming is optional. A blank name becomes the word for a timetable in the
 * user's language followed by the lowest positive number that is not already
 * taken — "Timetable1", "Timetable2"; "Расписание1"; "Stundenplan1". Taken
 * means held by the active timetable or by any archived one, compared without
 * regard to case or surrounding spaces, so "timetable1 " counts as
 * "Timetable1". A number freed by deleting its timetable is used again.
 *
 * Only generated names have to be unique. A name the user typed is theirs, and
 * two timetables both called "SoSe26" is a choice rather than a collision.
 *
 * Pure, and applied only when a timetable is actually created — never when the
 * setup flow merely opens — so abandoning the flow reserves nothing, and two
 * blank creations in a row get two different numbers.
 */
export function nextDefaultTimetableName(base: string, existingNames: readonly string[]): string {
  const stem = base.trim();
  // Nothing to number: the caller refuses a blank name rather than inventing "1".
  if (!stem) return "";
  const taken = new Set(existingNames.map((name) => name.trim().toLocaleLowerCase()));

  // Terminates: `taken` is finite, so some number past its size is free.
  for (let number = 1; ; number++) {
    const candidate = `${stem}${number}`;
    if (!taken.has(candidate.toLocaleLowerCase())) return candidate;
  }
}
