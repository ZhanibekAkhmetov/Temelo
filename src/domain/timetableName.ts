/**
 * The name a timetable gets when the user does not give it one.
 *
 * Naming is optional. A blank name becomes the plain word for a timetable in
 * the user's language — "Timetable", "Расписание", "Stundenplan" — and, when
 * that is already taken, the same word with the lowest number that is not:
 * "Timetable 2", "Timetable 3". Taken means held by the active timetable or by
 * any archived one, compared without regard to case or surrounding spaces, so
 * "timetable " counts as "Timetable".
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
  const taken = new Set(existingNames.map((name) => name.trim().toLocaleLowerCase()));
  if (!taken.has(stem.toLocaleLowerCase())) return stem;

  // Terminates: `taken` is finite, so some number past its size is free.
  for (let number = 2; ; number++) {
    const candidate = `${stem} ${number}`;
    if (!taken.has(candidate.toLocaleLowerCase())) return candidate;
  }
}
