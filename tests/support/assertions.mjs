/**
 * The assertions every suite is written in: one sentence saying what must be
 * true, then the thing that has to be true.
 *
 * These are the old harness's `check` and `equal`, kept so that every
 * assertion reads as a statement about the app rather than about an `assert`
 * call — but they now throw through `node:assert`, so a failing check fails its
 * test in Node's test runner, with the sentence as the message. A test stops
 * at its first failing check, which is how every test runner behaves and what
 * keeps one broken assumption from cascading into a page of follow-on
 * failures.
 *
 * `section` is a no-op: each section is now a `test(...)` of its own, named
 * where the suite registers it, and the runner prints that name.
 */

import assert from "node:assert/strict";

/** A heading inside a test; the test's own name is what the runner reports. */
export function section(_title) {}

/** Fails the current test, saying `description` and, if given, why. */
export function check(description, condition, detail) {
  assert.ok(condition, detail === undefined ? description : `${description} — ${detail}`);
  return true;
}

/** Strict equality (`===`), as the checks always compared. */
export function equal(description, actual, expected) {
  assert.strictEqual(actual, expected, description);
  return true;
}
