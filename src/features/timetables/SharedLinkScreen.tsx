import { useEffect, useRef } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { router } from "expo-router";

import { Button } from "@/components/Button";
import { ScreenContainer } from "@/components/ScreenContainer";
import { ImportPreviewDialog } from "@/features/timetables/ImportPreviewDialog";
import { useImportTimetable } from "@/features/timetables/transfer";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/useTheme";

/**
 * Where a share link lands: `<web app>/shared/<id>`.
 *
 * It downloads the timetable behind the id and shows the same import preview
 * the Import button shows — through `useImportTimetable`, so the same
 * validator, the same naming and the same cloning import, and nothing written
 * until the user confirms. The server is never trusted.
 *
 * Afterwards the user goes where the Timetables screen would send them: into
 * the timetable when it became the active one, to the archived timetable when
 * it joined the archive. Cancelling, or a link that does not work, goes to the
 * start of the app, which decides for itself whether that is setup or the
 * grid — a visitor who opened a link before ever using Temelo has not been set
 * up, and an import that did not happen does not change that.
 *
 * ## Arriving from outside the app
 *
 * On Android a tapped link reaches this same route (App Links, milestone
 * 14.7): Expo Router routes an `https` link by its path. A cold start begins
 * with this screen alone on the stack; a link tapped while Temelo is running
 * is pushed on top of whatever was open. Every way out therefore first drops
 * back to the bottom of the stack and then replaces it, so neither case leaves
 * a second grid underneath. Navigation only ever happens on the user's own
 * tap, long after the navigator has mounted — the timing the share receiver's
 * history warns about cannot arise here.
 */
export function SharedLinkScreen({ id }: { id: string }) {
  const { colors, spacing, typography } = useTheme();
  const { t } = useI18n();
  const importing = useImportTimetable();
  const { openLink } = importing;
  // Once per id: a link is opened when the screen arrives, not on every render.
  const opened = useRef<string | null>(null);

  useEffect(() => {
    if (opened.current === id) return;
    opened.current = id;
    openLink(id);
  }, [id, openLink]);

  /** Replaces the whole stack with `href`, however this screen was reached. */
  function exitTo(href: "/" | "/timetable") {
    if (router.canDismiss()) router.dismissAll();
    router.replace(href);
  }

  function leave() {
    importing.cancel();
    exitTo("/");
  }

  function confirm() {
    void importing.confirm().then((result) => {
      if (!result?.ok) return;
      exitTo("/timetable");
      if (result.destination === "archive") {
        router.push({ pathname: "/timetables/archived", params: { id: result.timetableId, imported: "1" } });
      }
    });
  }

  const failed = importing.error !== null && importing.pending === null;

  return (
    <View style={{ flex: 1 }}>
      <ScreenContainer desktopCard>
        <View style={{ marginTop: spacing.xxl, gap: spacing.lg, alignItems: "stretch" }}>
          {failed && importing.error ? (
            <>
              <Text accessibilityRole="header" style={[typography.title, { color: colors.textPrimary }]}>
                {t("sharedLink.failedTitle")}
              </Text>
              <Text style={[typography.body, { color: colors.danger }]}>
                {t(importing.error.key, importing.error.params)}
              </Text>
              <Button label={t("sharedLink.openApp")} variant="primary" onPress={leave} />
            </>
          ) : (
            <>
              <Text accessibilityRole="header" style={[typography.title, { color: colors.textPrimary }]}>
                {t("sharedLink.loadingTitle")}
              </Text>
              {importing.pending ? null : <ActivityIndicator color={colors.accent} />}
              <Text style={[typography.caption, { color: colors.textMuted }]}>{t("shareLink.creatingHint")}</Text>
            </>
          )}
        </View>
      </ScreenContainer>

      {importing.pending ? (
        <ImportPreviewDialog
          pending={importing.pending}
          busy={importing.busy}
          error={importing.error ? t(importing.error.key, importing.error.params) : undefined}
          onConfirm={confirm}
          onCancel={leave}
        />
      ) : null}
    </View>
  );
}
