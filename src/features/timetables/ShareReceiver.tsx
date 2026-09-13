import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, AppState, BackHandler, Modal, Platform, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { answeredShares } from "@/domain/incomingShare";
import { ImportPreviewDialog } from "@/features/timetables/ImportPreviewDialog";
import { previewTimetableFile, type ImportCandidate } from "@/features/timetables/importPipeline";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppState } from "@/state/AppStateContext";
import type { TemeloFileFailure } from "@/storage/timetableFile";
import { useTheme } from "@/theme/useTheme";
import {
  clearSharedTimetableFile,
  readSharedTimetableFile,
  readTimetableFileAt,
} from "@/util/timetableFiles";

/**
 * A timetable somebody shared into Temelo, handled and then left behind.
 *
 * Telegram, WhatsApp or Drive offers Temelo in the share sheet, Android hands
 * the app an `ACTION_SEND`, and this draws the whole of what happens next over
 * the top of everything else: reading, the same preview the Import button
 * shows, and then either "Timetable imported" or the reason it was refused.
 * Done leaves.
 *
 * ## It is a receiver, not a part of the app
 *
 * This is the one decision the feature turns on, and it is the opposite of what
 * was tried before. A share-launched Temelo is **not** treated as an ordinary
 * launch of the app that happens to have a file in its hand. It is a transient
 * errand: it has exactly six states, no navigation, and no way to reach
 * Settings, Timetables, the grid, or anything else. The imported timetable is
 * seen the way every other timetable is seen — by opening Temelo.
 *
 * Which is why this component imports no router and calls none. Not "avoids
 * calling one at the wrong time": has none to call. Every previous attempt at
 * this feature failed in the same place, and it was always a navigation:
 *
 *  - As a route of its own, a cold share landed on `/import` with an empty
 *    stack beneath it, so every way *out* had to build a stack imperatively —
 *    and a `push`/`replace` dispatched before the app's own `<Stack>` has
 *    mounted resolves against stale root state, is built with
 *    `target: undefined`, and reaches only Expo Router's internal slot
 *    navigator, which knows `__root`, `_sitemap` and `+not-found`. That is
 *    exactly "the action 'REPLACE' with payload ... was not handled by any
 *    navigator", and `navigationRef.isReady()` is already true when it happens,
 *    so no readiness check catches it.
 *  - As an overlay that still navigated to the imported timetable afterwards,
 *    the same dispatch was merely rarer. A race is not fixed by making it
 *    narrower.
 *
 * Removing the navigation removes the whole class of failure, and costs one
 * thing: the user is not taken to the timetable they just imported. That is a
 * deliberate trade — the file is on the device, which is what they asked for,
 * and reliability is worth more than a transition.
 *
 * ## Why an overlay rather than a screen
 *
 * Because a screen is a route, and a route means navigating. Mounted once by
 * the root layout beside the navigator, this draws `null` for the entire life
 * of an app nobody has shared anything to, and a `<Modal>` over whatever is
 * already on screen when somebody has. No stack is built, so none can be built
 * wrong, and `app/index.tsx`, `BootGate` and the `<Stack>` are all untouched by
 * this feature.
 *
 * ## How it learns a file has arrived
 *
 * By asking, on mount and on every return to the foreground. The payload lives
 * in a native singleton (`expo-sharing`'s), which is authoritative, cheap to
 * read and survives everything above it — so there is nothing to subscribe to
 * and no event that can be missed. A cold share is found by the mount; a warm
 * one by the resume, because a share always arrives by way of another app,
 * which means the app always comes back to the foreground to receive it.
 *
 * `app/+native-intent.ts` is the other half of the story and deliberately does
 * *not* feed this component. Its only job is to stop `expo-sharing`'s
 * fabricated `temelo://expo-sharing` link from being routed to; see
 * `domain/incomingShare`.
 */
export function ShareReceiver() {
  const { colors, spacing, typography, radii, borderWidth } = useTheme();
  const { t } = useI18n();
  const { state, hydrated, importTimetable, timetableNames } = useAppState();
  const [session, setSession] = useState<ShareSession>({ kind: "idle" });

  /**
   * Whether a payload is already being looked at.
   *
   * A ref rather than the session state, for the reason refs always beat state
   * in a guard: state is written for the *next* render, and both the mount and
   * a resume arriving in the same frame would otherwise each see `idle` and
   * each start reading the same file.
   */
  const busy = useRef(false);

  /**
   * The values a read needs, as of the last render.
   *
   * They are reached through a ref rather than closed over, and the reason is
   * the subscription below. `timetableNames` is rebuilt whenever app state
   * changes — which is every drag of a class across the grid — so a `receive`
   * that depended on it would tear down and re-register an `AppState` listener,
   * and call into the native share module, on every edit the user makes. This
   * component is mounted for the entire life of the app and must cost nothing
   * for the overwhelming majority of it.
   *
   * Updated after every render, and read only from inside an event, so what it
   * holds is always at least as fresh as the frame the user acted on. The
   * effect is declared before the subscription so that it has run by the time
   * the first `receive` can.
   */
  const latest = useRef({ hasActive: false, timetableNames, t });
  useEffect(() => {
    latest.current = { hasActive: state.timetable !== null, timetableNames, t };
  });

  /**
   * Takes whatever Android is holding and starts reading it.
   *
   * Waits for hydration, and does not consume the payload while it waits.
   * Reading is not the only thing the preview needs: the destination — archived
   * or active — comes from `state.timetable`, and the name comes from the names
   * already on the device. Both have wrong answers before storage has been read
   * back (`state.timetable` defaults to `null`), so a file handled in that
   * window would be previewed as "this becomes your timetable" to somebody who
   * already has one. Nothing is lost by waiting: the payload stays where it is,
   * and this callback's identity changes when `hydrated` does, which re-runs
   * the effect below and asks again.
   *
   * Safe to call at any time and from any number of signals. With no payload,
   * with one already being handled, or with one the user has already answered,
   * it does nothing at all.
   */
  const receive = useCallback(() => {
    if (!hydrated || busy.current) return;
    if (session.kind !== "idle") return;

    const shared = readSharedTimetableFile();
    if (!shared) return;
    /*
     * A file this user has already dealt with.
     *
     * Android redelivers the intent that started a task when the task is
     * resumed after the process was reclaimed, so without this the same preview
     * could be presented again — for a file that was imported, or declined, an
     * hour ago. Clearing it as well, because whatever redelivered it will do so
     * again otherwise.
     */
    if (answeredShares.has(shared.uri)) {
      clearSharedTimetableFile();
      return;
    }

    busy.current = true;
    setSession({ kind: "reading" });

    void (async () => {
      try {
        const file = await readTimetableFileAt(shared.uri);
        /*
         * Consumed here, the moment the bytes are a string in this process, and
         * not when the user answers.
         *
         * Two things follow, both wanted. The native singleton can no longer
         * present this file to anything — not to a later resume, not to a
         * remount — so "the payload is cleared exactly once" is true by there
         * being exactly one place that clears it. And the import no longer
         * depends on a `content://` grant that Android is free to revoke while
         * the user is reading the preview.
         */
        answeredShares.add(shared.uri);
        clearSharedTimetableFile();

        const { hasActive, timetableNames: names, t: translate } = latest.current;

        if (!file.ok) {
          if (__DEV__) console.warn(`[temelo/share] a shared file could not be read: ${file.detail}`);
          setSession({
            kind: "failed",
            message: translate(file.kind === "tooLarge" ? "errors.fileTooLarge" : "errors.fileUnreadable"),
          });
          return;
        }

        const preview = previewTimetableFile({
          text: file.text,
          hasActive,
          existingNames: await names(),
        });
        if (!preview.ok) {
          setSession({ kind: "failed", message: translate(refusalKey(preview.failure)) });
          return;
        }

        setSession({ kind: "preview", candidate: preview.candidate });
      } finally {
        busy.current = false;
      }
    })();
  }, [hydrated, session.kind]);

  // Mount covers a cold share — the payload is already waiting when this first
  // runs. The resume covers a warm one, and a share is always a return to the
  // foreground because it always comes by way of another app.
  useEffect(() => {
    receive();
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") receive();
    });
    return () => subscription.remove();
  }, [receive]);

  const confirm = useCallback(() => {
    if (session.kind !== "preview") return;
    const { candidate } = session;
    setSession({ kind: "importing", candidate });
    void importTimetable(candidate.snapshot).then((result) => {
      if (!result.ok) {
        // Back to the preview with the reason beside it: nothing was written,
        // and the user can try the same file again without going and finding
        // it a second time.
        setSession({ kind: "preview", candidate, error: t(result.error.key, result.error.params) });
        return;
      }
      setSession({ kind: "imported", name: candidate.name, destination: result.destination });
    });
  }, [session, importTimetable, t]);

  /**
   * Leaving, from every one of the three endings — Done, Close, and Cancel.
   *
   * One exit, because the user is looking at one thing. The share context is a
   * task they entered from another app, and Android's own gesture for leaving
   * such a task is Back: at the root it finishes the task and reveals whatever
   * was beneath, which is the app that did the sharing. `BackHandler.exitApp`
   * is precisely that gesture — `invokeDefaultOnBackPressed`, which disables
   * React Native's own back callback so the activity's default `finish()` runs
   * — so this does what Back does rather than something new, and returns the
   * user where Android has already decided they should go.
   *
   * Finishing rather than merely dismissing is also what makes two of this
   * feature's promises structural. There is no Temelo task left holding a
   * consumed share, and there is no task for Android to resume and redeliver an
   * `ACTION_SEND` to — so relaunching Temelo normally cannot reopen the
   * preview.
   *
   * The cost is that a Temelo that happened to be running is finished too, and
   * that is the honest trade: the visible state is identical either way — the
   * receiver over the app — so the button must behave identically, and making
   * it depend on something the user cannot see would be worse than the restart.
   * Everything Temelo holds is already in SQLite; what is lost is a splash
   * screen's worth of warmth. (`moveTaskToBack(true)` is the call that would
   * keep it, and nothing in React Native or Expo SDK 57 exposes it. It is a
   * dozen lines of Kotlin in a local module if that trade ever stops being
   * worth it.)
   *
   * ## Why it takes two renders
   *
   * `leave` puts the receiver back to `idle` and *asks* to go; the effect below
   * does the going. That is an ordering guarantee rather than a delay — there
   * is no timer here — and what it buys is that React has committed the
   * unmounting of the `<Modal>` before the activity is told to finish. An
   * activity destroyed with a dialog window still attached to it is the classic
   * "has leaked window" complaint, and this is the one line of code in the
   * feature that could produce one.
   *
   * On the platforms where `exitApp` does nothing — it is Android-only — the
   * reset *is* the exit, and the user is returned to whatever the app was
   * showing.
   */
  const [leaving, setLeaving] = useState(false);

  const leave = useCallback(() => {
    setSession({ kind: "idle" });
    setLeaving(true);
  }, []);

  useEffect(() => {
    if (!leaving) return;
    setLeaving(false);
    if (Platform.OS === "android") BackHandler.exitApp();
  }, [leaving]);

  if (session.kind === "preview" || session.kind === "importing") {
    return (
      <ImportPreviewDialog
        pending={session.candidate}
        busy={session.kind === "importing"}
        error={session.kind === "preview" ? session.error : undefined}
        onConfirm={confirm}
        onCancel={leave}
      />
    );
  }

  if (session.kind === "imported") {
    return (
      <ReceiverCard onRequestClose={leave}>
        <Text accessibilityRole="header" style={[typography.title, styles.centred, { color: colors.textPrimary }]}>
          {t("share.importedTitle")}
        </Text>
        {/* The name it actually got, which is not always the name in the file:
            a second copy of "SoSe26" is created as "SoSe26 (1)", and this is
            where the user finds that out. */}
        <Text style={[typography.body, styles.centred, { color: colors.textSecondary }]}>
          {t("share.importedBody", { name: session.name })}
        </Text>
        <Text style={[typography.caption, styles.centred, { color: colors.textMuted }]}>
          {t(session.destination === "active" ? "share.importedAsActive" : "share.importedAsArchive")}
        </Text>
        <Button label={t("common.done")} variant="primary" onPress={leave} />
      </ReceiverCard>
    );
  }

  if (session.kind === "failed") {
    /*
     * A file that is not a Temelo timetable, in the same words the Import
     * button uses, with its own way out.
     *
     * Nothing was written — a refusal happens before any transaction exists —
     * so Close is not an undo, and the message says what is wrong with the file
     * rather than what went wrong with the app.
     */
    return (
      <ReceiverCard onRequestClose={leave}>
        <Text accessibilityRole="header" style={[typography.body, styles.centred, { color: colors.textPrimary }]}>
          {t("share.failedTitle")}
        </Text>
        <Text style={[typography.caption, styles.centred, { color: colors.danger }]}>{session.message}</Text>
        <Button label={t("common.close")} variant="secondary" onPress={leave} />
      </ReceiverCard>
    );
  }

  if (session.kind === "reading") {
    /*
     * Usually one frame, and still drawn: a file a provider has to fetch from
     * the network before it can be opened is not instant, and without this the
     * tap on "Temelo" in the share sheet would look like it had done nothing.
     *
     * No way out of this state on purpose. It is bounded by a read of a file
     * that has already been size-checked, and every way that read can end —
     * including every way it can fail — moves to a state that has one.
     */
    return (
      <ReceiverCard>
        <Text accessibilityRole="header" style={[typography.body, styles.centred, { color: colors.textPrimary }]}>
          {t("share.readingTitle")}
        </Text>
        <ActivityIndicator color={colors.accent} />
      </ReceiverCard>
    );
  }

  return null;

  /**
   * The themed panel the three plain states share.
   *
   * Declared inside so it can read the theme the enclosing component has
   * already resolved, and rendered from exactly one branch at a time — each of
   * which returns immediately — so a change of identity can never unmount
   * something the user is looking at.
   */
  function ReceiverCard({ children, onRequestClose }: { children: ReactNode; onRequestClose?: () => void }) {
    return (
      <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onRequestClose}>
        <View style={[styles.root, { backgroundColor: colors.overlay, padding: spacing.xl }]}>
          <View
            accessibilityViewIsModal
            style={[
              styles.card,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.divider,
                borderWidth: borderWidth.thin,
                borderRadius: radii.lg,
                padding: spacing.lg,
                gap: spacing.md,
              },
            ]}
          >
            {children}
          </View>
        </View>
      </Modal>
    );
  }
}

/**
 * Everything the receiver can be, and nothing else.
 *
 * Six states, one of which draws nothing. There is no state for "somewhere in
 * the app": that is the whole point — see the note at the top. `importing`
 * keeps the candidate so the preview stays on screen while the write runs, and
 * so a failed write can return to it with the file still in hand.
 */
type ShareSession =
  /** Nothing has been shared, or the user has finished with what was. */
  | { kind: "idle" }
  /** A payload exists and its bytes are being read. */
  | { kind: "reading" }
  /** Validated, waiting for the user. `error` is a write that did not land. */
  | { kind: "preview"; candidate: ImportCandidate; error?: string }
  /** Confirmed; the transaction is running. */
  | { kind: "importing"; candidate: ImportCandidate }
  /** It is on the device, under `name`. */
  | { kind: "imported"; name: string; destination: "active" | "archive" }
  /** The file was refused, or could not be read. Already translated. */
  | { kind: "failed"; message: string };

/** Why a `.temelo` was refused, in words — the same four the picker uses. */
function refusalKey(failure: TemeloFileFailure) {
  switch (failure.kind) {
    case "notTemelo":
      return "errors.fileNotTemelo" as const;
    case "futureVersion":
      return "errors.fileFutureVersion" as const;
    case "tooLarge":
      return "errors.fileTooLarge" as const;
    case "damaged":
      return "errors.fileDamaged" as const;
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    width: "100%",
    maxWidth: 420,
  },
  centred: {
    textAlign: "center",
  },
});
