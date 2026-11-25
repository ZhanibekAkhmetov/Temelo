/**
 * The app config: `app.json`, plus what depends on where the web app lives.
 *
 * Expo reads `app.json` first and hands it to this function as `config`; the
 * only thing added here is Android App Links for share links (milestone
 * 14.7). A share link is `<web app>/shared/<id>`. With an intent filter for
 * that address marked `autoVerify`, and the web app serving
 * `/.well-known/assetlinks.json` with this app's signing fingerprint, Android
 * opens the installed app for a tapped link instead of the browser — and the
 * incoming URL lands on the same `/shared/[id]` route the web uses, because
 * Expo Router routes an `https` link by its path.
 *
 * The address comes from `EXPO_PUBLIC_TEMELO_WEB_URL`, the variable share
 * links already use (`util/shareLinkApi`), so the domain is configuration and
 * not code: `eas.json` sets it for every build profile, and changing it means
 * a new build, because an intent filter is compiled into the app.
 */

import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * The share-link route, as `SHARE_LINK_PATH` in `src/domain/shareLink.ts`.
 *
 * Repeated rather than imported: the config is evaluated by Expo's loader,
 * which does not resolve the app's `@/` alias. `tests/appLinks.test.ts`
 * asserts the two agree.
 */
export const SHARE_LINK_PATH = "/shared/";

type IntentFilter = NonNullable<NonNullable<ExpoConfig["android"]>["intentFilters"]>[number];

/**
 * The App Links intent filter for share links on the web app at `webUrl`, or
 * none.
 *
 * Only an `https` address on the default port qualifies: that is all Android
 * verifies, so anything else — a local `http://localhost:8081` while
 * developing, or nothing at all — gets no filter rather than one that could
 * never be verified. A web app hosted below the domain root keeps its path in
 * front of `/shared/`.
 */
export function shareLinkIntentFilters(webUrl: string | undefined): IntentFilter[] {
  if (!webUrl) return [];
  let url: URL;
  try {
    url = new URL(webUrl.trim());
  } catch {
    return [];
  }
  if (url.protocol !== "https:" || url.port !== "") return [];

  const base = url.pathname.replace(/\/+$/, "");
  return [
    {
      action: "VIEW",
      autoVerify: true,
      data: [{ scheme: "https", host: url.hostname, pathPrefix: `${base}${SHARE_LINK_PATH}` }],
      category: ["BROWSABLE", "DEFAULT"],
    },
  ];
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? "Temelo",
  slug: config.slug ?? "Temelo",
  android: {
    ...config.android,
    intentFilters: [
      ...(config.android?.intentFilters ?? []),
      ...shareLinkIntentFilters(process.env.EXPO_PUBLIC_TEMELO_WEB_URL),
    ],
  },
});
