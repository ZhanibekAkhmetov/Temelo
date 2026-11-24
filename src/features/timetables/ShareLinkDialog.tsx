import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/Button";
import { DialogCard } from "@/components/DialogCard";
import { isoDateOf } from "@/domain/date";
import type { ShareLinkState } from "@/features/timetables/transfer";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/theme/useTheme";
import { CAN_COPY_LINKS, CAN_SHARE_LINKS, copyLink, shareLink } from "@/util/linkSharing";

interface ShareLinkDialogProps {
  /** The timetable being shared, named in the sentence under the link. */
  name: string;
  state: Exclude<ShareLinkState, { kind: "idle" }>;
  onRetry: () => void;
  onDismiss: () => void;
}

/**
 * Creating a share link, and handing it over.
 *
 * Three states, one card. While the upload runs it says so — and says the
 * server may take a minute, because on a free host a sleeping server takes
 * that long to wake, and an unexplained spinner that long looks broken. Then
 * the link itself, selectable, with the one fact the recipient's experience
 * depends on: until when it works. Then the ways to pass it on that this
 * platform has — Copy in a browser, the share sheet on a phone (whose Copy is
 * built in) and in a browser that has one.
 *
 * Cancel while creating only stops waiting: the upload may still land, and
 * then expires on its own like any other share.
 */
export function ShareLinkDialog({ name, state, onRetry, onDismiss }: ShareLinkDialogProps) {
  const { colors, spacing, radii, typography } = useTheme();
  const { t, format } = useI18n();
  const [copied, setCopied] = useState(false);

  if (state.kind === "creating") {
    return (
      <DialogCard onRequestClose={onDismiss}>
        <Text accessibilityRole="header" style={[typography.subtitle, { color: colors.textPrimary }]}>
          {t("shareLink.creatingTitle")}
        </Text>
        <ActivityIndicator color={colors.accent} />
        <Text style={[typography.caption, { color: colors.textMuted }]}>{t("shareLink.creatingHint")}</Text>
        <Button label={t("common.cancel")} variant="secondary" onPress={onDismiss} />
      </DialogCard>
    );
  }

  if (state.kind === "failed") {
    return (
      <DialogCard onRequestClose={onDismiss}>
        <Text accessibilityRole="header" style={[typography.subtitle, { color: colors.textPrimary }]}>
          {t("shareLink.failedTitle")}
        </Text>
        <Text style={[typography.body, { color: colors.danger }]}>{t(state.error.key, state.error.params)}</Text>
        <View style={{ gap: spacing.sm }}>
          <Button label={t("shareLink.retry")} variant="primary" onPress={onRetry} />
          <Button label={t("common.close")} variant="secondary" onPress={onDismiss} />
        </View>
      </DialogCard>
    );
  }

  const { url } = state;
  const until = format.dateLong(isoDateOf(new Date(state.expiresAt)));

  async function copy() {
    const result = await copyLink(url);
    setCopied(result.ok);
  }

  return (
    <DialogCard onRequestClose={onDismiss}>
      <Text accessibilityRole="header" style={[typography.subtitle, { color: colors.textPrimary }]}>
        {t("shareLink.readyTitle")}
      </Text>
      {/* Selectable, so the link can be copied by hand wherever neither the
          clipboard nor a share sheet is available. */}
      <Text
        selectable
        accessibilityLabel={url}
        style={[
          typography.body,
          styles.link,
          {
            color: colors.textPrimary,
            backgroundColor: colors.inputBackground,
            borderRadius: radii.sm,
            padding: spacing.sm,
          },
        ]}
      >
        {url}
      </Text>
      <Text style={[typography.caption, { color: colors.textSecondary }]}>
        {t("shareLink.readyBody", { name, date: until })}
      </Text>
      {copied ? (
        <Text accessibilityLiveRegion="polite" style={[typography.caption, { color: colors.textMuted }]}>
          {t("shareLink.copied")}
        </Text>
      ) : null}
      <View style={{ gap: spacing.sm }}>
        {CAN_COPY_LINKS ? <Button label={t("shareLink.copy")} variant="primary" onPress={() => void copy()} /> : null}
        {CAN_SHARE_LINKS ? (
          <Button
            label={t("shareLink.share")}
            variant={CAN_COPY_LINKS ? "secondary" : "primary"}
            onPress={() => void shareLink({ url, dialogTitle: t("shareLink.dialogTitle") })}
          />
        ) : null}
        <Button label={t("common.done")} variant="secondary" onPress={onDismiss} />
      </View>
    </DialogCard>
  );
}

const styles = StyleSheet.create({
  link: {
    // A link has no spaces to break at; let it break anywhere rather than
    // overflow the card.
    flexShrink: 1,
  },
});
