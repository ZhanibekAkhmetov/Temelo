/**
 * The harness's reporting, shared by every suite so one run gives one score.
 *
 * Deliberately tiny. There is no test runner in this project and this is not
 * an attempt to write one: it prints a line per assertion and exits non-zero
 * if any of them failed, which is all a `node harness/run.mjs` in a terminal
 * needs to be useful.
 */

let checks = 0;
let failures = 0;

export function section(title) {
  console.log(`\n${title}`);
}

export function check(description, condition, detail) {
  checks++;
  if (condition) {
    console.log(`  ok   ${description}`);
    return true;
  }
  failures++;
  console.log(`  FAIL ${description}${detail === undefined ? "" : ` — ${detail}`}`);
  return false;
}

export function equal(description, actual, expected) {
  return check(
    description,
    actual === expected,
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

/** Prints the score and sets the exit code. Called once, by `run.mjs`. */
export function summarize() {
  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) process.exitCode = 1;
}
