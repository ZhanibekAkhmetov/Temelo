/**
 * Storage harness.
 *
 * There is no test runner in this project, so this is a plain Node script that
 * exercises the real storage modules — the migrations, the schema repair, the
 * transaction queue and the repository — against Node's own SQLite. It is not
 * a substitute for the device: it cannot tell you how `expo-sqlite`'s native
 * layer behaves. It *can* tell you whether an academic-day change is written
 * atomically, whether two overlapping writers still destroy each other's
 * transactions, and whether a rolled-back write leaves the database on its
 * previous configuration — which is what this milestone is about.
 *
 * Run it with `node harness/run.mjs`.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createId } from "@/domain/id";
import { generateTimeSlots } from "@/domain/time";
import { createDefaultTerm, createDefaultTimeSlots, DEFAULT_SETTINGS } from "@/state/defaults";
import { createSampleTimetable } from "@/state/sampleTimetable";
import { openTemeloDatabase } from "@/storage/database";
import { loadTimetable, saveTimetable } from "@/storage/timetableRepository";
import { withTransaction } from "@/storage/transaction";
import { check, equal, section } from "./report.mjs";
import { useDatabaseFile } from "./sqlite-stub.mjs";

// ------------------------------------------------------------- app fixtures

/**
 * `setAcademicDayConfig` from `AppStateContext`, as a pure state transition.
 *
 * Deliberately the same shape as the real one — regenerate every period with a
 * fresh id, keep `slotCount` in step with them, tombstone everything that
 * pointed at the old periods — because the thing under test is whether that
 * shape survives a round trip through SQLite.
 */
function applyAcademicDay(state, slotCount) {
  const result = generateTimeSlots({
    dayStart: state.settings.academicDayStart,
    lessonDurationMinutes: state.settings.defaultLessonDurationMinutes,
    breakDurationMinutes: state.settings.defaultBreakDurationMinutes,
    slotCount,
  });
  if (!result.ok) throw new Error(`generateTimeSlots refused ${slotCount}: ${result.error.key}`);

  const now = new Date().toISOString();
  return {
    ...state,
    settings: { ...state.settings, slotCount },
    timeSlots: result.slots.map((slot) => ({
      id: createId(),
      position: slot.position,
      startTime: slot.startTime,
      endTime: slot.endTime,
    })),
    placements: state.placements.map((p) => (p.deletedAt ? p : { ...p, deletedAt: now, updatedAt: now })),
    exceptions: state.exceptions.map((e) => (e.deletedAt ? e : { ...e, deletedAt: now, updatedAt: now })),
  };
}

function freshState() {
  // A 45/10 day rather than the 90/20 default, so that every slot count this
  // harness walks through — up to ten periods — actually fits inside a day.
  // `generateTimeSlots` refuses a tenth ninety-minute period on principle, and
  // that refusal is its own behaviour, not the one under test here.
  const settings = {
    ...DEFAULT_SETTINGS,
    defaultLessonDurationMinutes: 45,
    defaultBreakDurationMinutes: 10,
    onboardingCompleted: true,
  };
  const result = generateTimeSlots({
    dayStart: settings.academicDayStart,
    lessonDurationMinutes: settings.defaultLessonDurationMinutes,
    breakDurationMinutes: settings.defaultBreakDurationMinutes,
    slotCount: settings.slotCount,
  });
  if (!result.ok) throw new Error("default academic day does not generate");

  const now = new Date().toISOString();
  const timeSlots = result.slots.map((slot) => ({
    id: createId(),
    position: slot.position,
    startTime: slot.startTime,
    endTime: slot.endTime,
  }));

  const course = {
    id: createId(),
    name: "Discrete Mathematics",
    room: "B-214",
    teacher: "Dr Weber",
    notes: "bring the problem sheet",
    appearanceId: "blue",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  const placement = {
    id: createId(),
    courseId: course.id,
    weekday: "tuesday",
    timeSlotId: timeSlots[2].id,
    slotSpan: 2,
    recurrenceType: "biweekly",
    startsOn: "2026-09-08",
    endsOn: "2026-12-22",
    reminderMinutes: 45,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  const exception = {
    id: createId(),
    placementId: placement.id,
    originalDate: "2026-09-22",
    effectiveDate: "2026-09-23",
    state: "modified",
    timeSlotId: timeSlots[4].id,
    slotSpan: 1,
    name: "Discrete Mathematics (lab)",
    room: null,
    teacher: null,
    notes: null,
    appearanceId: "magenta",
    reminderMinutes: 10,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  return {
    settings,
    term: { ...createDefaultTerm(), name: "Autumn 2026" },
    timeSlots,
    courses: [course],
    placements: [placement],
    exceptions: [exception],
  };
}

// --------------------------------------------------------- provider model

/**
 * `AppStateProvider`'s persistence rules, with React taken out.
 *
 * A model, not the code itself: the provider is a React component and cannot
 * be mounted here. What is modelled is exactly the part this milestone
 * changed — one serialized write queue, a diff baseline that only advances on
 * a committed transaction, a separate last-known-good snapshot, and the revert
 * that puts the app back on that snapshot when a write is rejected.
 */
class Store {
  constructor(db, state) {
    this.db = db;
    this.state = state;
    this.persisted = null;
    this.lastKnownGood = null;
    this.queue = Promise.resolve();
    this.failures = [];
    this.writes = 0;
  }

  /** Hydration: what was read back is both the state and the baseline. */
  hydrate(timetable) {
    this.state = timetable;
    this.persisted = timetable;
    this.lastKnownGood = timetable;
  }

  setState(next) {
    this.state = next;
    this.queue = this.queue.then(async () => {
      const previous = this.persisted;
      const attempted = next;
      if (previous === attempted) return;
      try {
        await saveTimetable(this.db, attempted, previous);
        this.persisted = attempted;
        this.lastKnownGood = attempted;
        this.writes++;
      } catch (error) {
        this.persisted = null;
        this.failures.push(error instanceof Error ? error.message : String(error));
        const knownGood = this.lastKnownGood;
        if (knownGood && knownGood !== attempted && this.state === attempted) {
          this.persisted = knownGood;
          this.state = knownGood;
        }
      }
    });
    return this.queue;
  }

  settled() {
    return this.queue;
  }
}

// -------------------------------------------------------------------- runs

const directory = mkdtempSync(join(tmpdir(), "temelo-harness-"));
let databaseIndex = 0;

async function openFresh() {
  const path = join(directory, `temelo-${databaseIndex++}.db`);
  useDatabaseFile(path);
  const opened = await openTemeloDatabase();
  return { ...opened, path };
}

/** Re-opens the same file, exactly as a cold app launch would. */
async function reopen(path) {
  useDatabaseFile(path);
  const opened = await openTemeloDatabase();
  return { ...opened, timetable: await loadTimetable(opened.db) };
}

async function storedSlotCount(db) {
  const row = await db.getFirstAsync("SELECT COUNT(*) AS count FROM time_slots");
  return row?.count ?? 0;
}

async function storedSettingsSlotCount(db) {
  const row = await db.getFirstAsync("SELECT slot_count FROM settings WHERE id = 'app'");
  return row?.slot_count ?? null;
}

// 1-4. Repeated academic-day reconfiguration, with a cold reopen after each.
async function testReconfiguration() {
  section("Academic day reconfigured repeatedly (8 -> 7 -> 8 -> 6 -> 10 -> 7)");

  const first = await openFresh();
  const path = first.path;
  const store = new Store(first.db, freshState());
  await store.setState(store.state);
  await store.settled();

  for (const slotCount of [7, 8, 6, 10, 7]) {
    const previousSlotIds = new Set(store.state.timeSlots.map((slot) => slot.id));
    await store.setState(applyAcademicDay(store.state, slotCount));
    await store.settled();

    equal(`${slotCount} periods: no write failed`, store.failures.length, 0);
    equal(`${slotCount} periods: settings.slot_count in the database`, await storedSettingsSlotCount(store.db), slotCount);
    equal(`${slotCount} periods: live time_slots rows`, await storedSlotCount(store.db), slotCount);

    // The old periods really are gone rather than sitting alongside the new
    // ones — the failure mode that used to break `time_slots.position`.
    const rows = await store.db.getAllAsync("SELECT id FROM time_slots");
    check(
      `${slotCount} periods: no retired slot survived the change`,
      rows.every((row) => !previousSlotIds.has(row.id)),
      `${rows.filter((row) => previousSlotIds.has(row.id)).length} old rows remain`,
    );

    store.db.closeSync();
    const relaunched = await reopen(path);
    equal(`${slotCount} periods: survives a cold reopen`, relaunched.timetable.timeSlots.length, slotCount);
    equal(
      `${slotCount} periods: reopened settings agree with the rows`,
      relaunched.timetable.settings.slotCount,
      relaunched.timetable.timeSlots.length,
    );
    store.db = relaunched.db;
    store.hydrate(relaunched.timetable);
  }

  store.db.closeSync();
}

// 5 & 7. A rejected transaction leaves both halves on the previous state.
async function testRollbackLeavesEverythingIntact() {
  section("A rejected write leaves the database and the app on the previous academic day");

  const opened = await openFresh();
  const db = opened.db;
  const store = new Store(db, freshState());
  await store.setState(store.state);
  await store.settled();

  const before = store.state;
  equal("starts at 8 periods", await storedSlotCount(db), 8);

  // Fail one statement in the middle of the write, after some of it has
  // already been applied — the only case in which atomicity means anything.
  db.failPattern = "INSERT INTO time_slots";
  await store.setState(applyAcademicDay(store.state, 5));
  await store.settled();

  equal("the write was reported as failed", store.failures.length, 1);
  check(
    "the failure names the injected cause, not a rollback",
    store.failures[0].includes("injected failure"),
    store.failures[0],
  );
  check(
    "no 'cannot rollback - no transaction is active'",
    !store.failures[0].includes("cannot rollback"),
    store.failures[0],
  );
  check("the connection is out of its transaction", !db.isInTransactionSync(), "still in a transaction");

  equal("the database still holds the previous 8 periods", await storedSlotCount(db), 8);
  equal("the database still says 8", await storedSettingsSlotCount(db), 8);
  check("the app reverted to the last state that committed", store.state === before, "state was left on the rejection");
  equal("in-memory settings and periods still agree", store.state.settings.slotCount, store.state.timeSlots.length);

  // And the app is not wedged: the next change saves normally.
  await store.setState(applyAcademicDay(store.state, 9));
  await store.settled();
  equal("a later change still saves", store.failures.length, 1);
  equal("...and lands", await storedSlotCount(db), 9);
  equal("...with settings in step", await storedSettingsSlotCount(db), 9);

  db.closeSync();
}

// 6. Two writers on one connection, which is what actually broke.
async function testConcurrentWriters() {
  section("Two writers on one connection (the timetable save and the reminder ledger)");

  const opened = await openFresh();
  const db = opened.db;
  const store = new Store(db, freshState());
  await store.setState(store.state);
  await store.settled();

  // The ledger's write, in the shape it really has: its own transaction, on
  // the same handle, started while the academic-day save is in flight.
  const ledgerWrite = () =>
    withTransaction(db, async () => {
      await db.runAsync(
        "INSERT INTO reminder_deliveries (reminder_key, remind_at, start_at, state, updated_at) VALUES (?, ?, ?, ?, ?) " +
          "ON CONFLICT (reminder_key) DO UPDATE SET updated_at = excluded.updated_at",
        `k-${Math.random().toString(36).slice(2)}`,
        1,
        2,
        "scheduled",
        new Date().toISOString(),
      );
    });

  const ledgerErrors = [];
  await Promise.all([
    store.setState(applyAcademicDay(store.state, 7)),
    ledgerWrite().catch((error) => ledgerErrors.push(String(error))),
    ledgerWrite().catch((error) => ledgerErrors.push(String(error))),
    ledgerWrite().catch((error) => ledgerErrors.push(String(error))),
  ]);
  await store.settled();

  equal("the timetable save succeeded", store.failures.length, 0);
  equal("no ledger write failed", ledgerErrors.length, 0, ledgerErrors.join(" | "));
  equal("the academic-day change landed", await storedSlotCount(db), 7);
  equal("...and settings agree", await storedSettingsSlotCount(db), 7);
  equal("the ledger rows landed too", (await db.getAllAsync("SELECT 1 FROM reminder_deliveries")).length, 3);

  db.closeSync();
}

/**
 * The control: the same two writers over `expo-sqlite`'s own
 * `withTransactionAsync`, which is what the app used to call.
 *
 * This is here so the diagnosis is not an assertion. If this stops
 * reproducing, the harness is no longer testing what it claims to.
 */
async function testUnserializedControl() {
  section("Control: the same two writers over expo-sqlite's withTransactionAsync");

  const opened = await openFresh();
  const db = opened.db;
  const errors = [];

  const write = (key) =>
    db
      .withTransactionAsync(async () => {
        await db.runAsync(
          "INSERT INTO reminder_deliveries (reminder_key, remind_at, start_at, state, updated_at) VALUES (?, ?, ?, ?, ?)",
          key,
          1,
          2,
          "scheduled",
          new Date().toISOString(),
        );
      })
      .catch((error) => errors.push(String(error)));

  await Promise.all([write("a"), write("b"), write("c")]);

  check("overlapping unserialized transactions do fail", errors.length > 0, "they did not, which invalidates the control");
  check(
    "and the error they report is the rollback, not the cause: 'cannot rollback - no transaction is active'",
    errors.some((message) => message.includes("cannot rollback")),
    errors.join(" | "),
  );

  db.closeSync();
}

// 8 & 9. Everything else that has to keep working.
async function testOrdinaryPersistence() {
  section("Ordinary persistence: preferences, recurrence, reminders, colour");

  const opened = await openFresh();
  const path = opened.path;
  const store = new Store(opened.db, freshState());
  await store.setState(store.state);
  await store.settled();

  // An atomic preference: one tap, straight to the store, no Save button.
  await store.setState({
    ...store.state,
    settings: {
      ...store.state.settings,
      appearancePreference: "dark",
      languagePreference: "ru",
      weekendMode: "sundayOnly",
      gridOrientation: "horizontal",
      defaultReminderMinutes: 15,
    },
  });
  await store.settled();
  equal("no write failed", store.failures.length, 0);

  store.db.closeSync();
  const relaunched = await reopen(path);
  const { settings, placements, exceptions, courses } = relaunched.timetable;

  equal("appearance survives a relaunch", settings.appearancePreference, "dark");
  equal("language survives a relaunch", settings.languagePreference, "ru");
  equal("weekend mode survives a relaunch", settings.weekendMode, "sundayOnly");
  equal("layout survives a relaunch", settings.gridOrientation, "horizontal");
  equal("default reminder survives a relaunch", settings.defaultReminderMinutes, 15);

  equal("recurrence type survives", placements[0].recurrenceType, "biweekly");
  equal("biweekly anchor date survives", placements[0].startsOn, "2026-09-08");
  equal("slot span survives", placements[0].slotSpan, 2);
  equal("placement reminder survives", placements[0].reminderMinutes, 45);
  equal("course colour survives", courses[0].appearanceId, "blue");
  equal("exception colour override survives", exceptions[0].appearanceId, "magenta");
  equal("exception reminder override survives", exceptions[0].reminderMinutes, 10);
  equal("exception state survives", exceptions[0].state, "modified");

  relaunched.db.closeSync();
}

/**
 * The two states the app can build without any user input at all.
 *
 * Both are saved verbatim — a reset writes one, the development sample writes
 * the other — so if either one's `slotCount` ever stopped matching the periods
 * beside it, every save from that point on would be refused. Cheap to check,
 * and it fails at the fixture rather than at the disk.
 */
async function testBuiltInStatesAreCoherent() {
  section("The states the app builds for itself agree with themselves");

  const emptySlots = createDefaultTimeSlots();
  equal("a fresh install's periods match its slot count", emptySlots.length, DEFAULT_SETTINGS.slotCount);

  const sample = createSampleTimetable();
  equal("the sample timetable's periods match its slot count", sample.timeSlots.length, sample.settings.slotCount);

  const opened = await openFresh();
  let saved = true;
  try {
    await saveTimetable(opened.db, sample, null);
  } catch {
    saved = false;
  }
  check("and the sample saves", saved, "it was refused");
  equal("with the periods it claims", await storedSlotCount(opened.db), sample.settings.slotCount);
  opened.db.closeSync();
}

// An incoherent payload is refused before it can reach the disk at all.
async function testIncoherentPayloadRefused() {
  section("An academic day whose two halves disagree is refused");

  const opened = await openFresh();
  const db = opened.db;
  const state = freshState();
  await saveTimetable(db, state, null);

  const incoherent = { ...state, settings: { ...state.settings, slotCount: 3 } };
  let message = null;
  try {
    await saveTimetable(db, incoherent, state);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  check("the save was refused", message !== null, "it was accepted");
  check("and said what was wrong", (message ?? "").includes("incoherent academic day"), message);
  equal("the database is untouched", await storedSettingsSlotCount(db), 8);
  equal("...and still has its periods", await storedSlotCount(db), 8);

  db.closeSync();
}

export async function runStorageHarness() {
  try {
    await testReconfiguration();
    await testRollbackLeavesEverythingIntact();
    await testConcurrentWriters();
    await testUnserializedControl();
    await testOrdinaryPersistence();
    await testIncoherentPayloadRefused();
    await testBuiltInStatesAreCoherent();
  } finally {
    // Windows keeps a handle on a WAL database for a moment after it is
    // closed; failing to tidy a temporary directory is not a test result.
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch {
      console.log(`\n(left ${directory} behind; the platform still had it open)`);
    }
  }
}
