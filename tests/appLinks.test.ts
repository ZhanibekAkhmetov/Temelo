/// <reference types="node" />
// Node's own types (node:test, node:assert) for the type check; see
// geometry.desktop.test.ts.

/**
 * Opening a share link in the installed Android app (milestone 14.7).
 *
 * What can be proved without a phone: the intent filter `app.config.ts`
 * derives from the web address, that it covers exactly the share-link route
 * the app and the web use, that every build profile is given the same https
 * address, and that the web build ships a Digital Asset Links file naming
 * this app. Whether Android then verifies the domain and opens the app is a
 * device question — see the checklist in docs/ROADMAP.md, 14.7.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import appConfig, { SHARE_LINK_PATH as CONFIG_PATH, shareLinkIntentFilters } from "../app.config";
import { SHARE_LINK_PATH, shareLinkUrl } from "@/domain/shareLink";

const ROOT = process.cwd();
const readJson = (...parts: string[]): unknown => JSON.parse(readFileSync(join(ROOT, ...parts), "utf8"));

const appJson = readJson("app.json") as { expo: Record<string, unknown> & { android: { package: string } } };
const easJson = readJson("eas.json") as { build: Record<string, { env?: Record<string, string> }> };
const assetLinks = readJson("public", ".well-known", "assetlinks.json") as {
  relation: string[];
  target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] };
}[];

const WEB = "https://temelo.example";

describe("the App Links intent filter", () => {
  it("covers the share-link route on the web app's host, and asks to be verified", () => {
    assert.deepEqual(shareLinkIntentFilters(WEB), [
      {
        action: "VIEW",
        autoVerify: true,
        data: [{ scheme: "https", host: "temelo.example", pathPrefix: "/shared/" }],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ]);
  });

  it("uses the same route the app builds links for", () => {
    assert.equal(CONFIG_PATH, SHARE_LINK_PATH);
    const [filter] = shareLinkIntentFilters(WEB);
    const data = Array.isArray(filter.data) ? filter.data[0] : filter.data;
    const link = new URL(shareLinkUrl(WEB, "o2Gx0b5cQd2u8rT1yKz3Aw"));
    assert.equal(link.hostname, data?.host);
    assert.ok(link.pathname.startsWith(data?.pathPrefix ?? "?"), link.pathname);
  });

  it("keeps a web app's own path in front of /shared/", () => {
    const [filter] = shareLinkIntentFilters("https://host.example/temelo/");
    const data = Array.isArray(filter.data) ? filter.data[0] : filter.data;
    assert.equal(data?.pathPrefix, "/temelo/shared/");
  });

  it("is not added for anything Android could never verify", () => {
    for (const value of [undefined, "", "not a url", "http://localhost:8081", "http://temelo.example", "https://temelo.example:8443"]) {
      assert.deepEqual(shareLinkIntentFilters(value), [], String(value));
    }
  });
});

describe("the app config", () => {
  it("adds the filter to app.json and keeps everything else", () => {
    const previous = process.env.EXPO_PUBLIC_TEMELO_WEB_URL;
    process.env.EXPO_PUBLIC_TEMELO_WEB_URL = WEB;
    try {
      const config = appConfig({ config: appJson.expo, projectRoot: ROOT, staticConfigPath: null, packageJsonPath: null });
      assert.equal(config.android?.package, appJson.expo.android.package);
      assert.equal(config.scheme, "temelo");
      assert.equal(config.android?.intentFilters?.length, 1);
      assert.equal(config.android?.intentFilters?.[0].autoVerify, true);
    } finally {
      if (previous === undefined) delete process.env.EXPO_PUBLIC_TEMELO_WEB_URL;
      else process.env.EXPO_PUBLIC_TEMELO_WEB_URL = previous;
    }
  });

  it("adds no filter in a build that has no web address", () => {
    const previous = process.env.EXPO_PUBLIC_TEMELO_WEB_URL;
    delete process.env.EXPO_PUBLIC_TEMELO_WEB_URL;
    try {
      const config = appConfig({ config: appJson.expo, projectRoot: ROOT, staticConfigPath: null, packageJsonPath: null });
      assert.deepEqual(config.android?.intentFilters, []);
    } finally {
      if (previous !== undefined) process.env.EXPO_PUBLIC_TEMELO_WEB_URL = previous;
    }
  });
});

describe("the build profiles", () => {
  it("all give the same https web address, which yields a filter", () => {
    const addresses = Object.entries(easJson.build).map(([name, profile]) => [name, profile.env?.EXPO_PUBLIC_TEMELO_WEB_URL]);
    for (const [name, address] of addresses) assert.match(address ?? "", /^https:\/\//, `${name} has no https web address`);
    assert.equal(new Set(addresses.map(([, address]) => address)).size, 1, "profiles disagree");
    assert.equal(shareLinkIntentFilters(addresses[0][1]).length, 1);
  });
});

describe("the Digital Asset Links file", () => {
  it("lets this app handle the web app's links", () => {
    assert.equal(assetLinks.length, 1);
    assert.deepEqual(assetLinks[0].relation, ["delegate_permission/common.handle_all_urls"]);
    assert.equal(assetLinks[0].target.namespace, "android_app");
    assert.equal(assetLinks[0].target.package_name, appJson.expo.android.package);
  });

  it("names at least one signing certificate, as colon-separated SHA-256", () => {
    const fingerprints = assetLinks[0].target.sha256_cert_fingerprints;
    assert.ok(fingerprints.length >= 1);
    for (const fingerprint of fingerprints) assert.match(fingerprint, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });
});
