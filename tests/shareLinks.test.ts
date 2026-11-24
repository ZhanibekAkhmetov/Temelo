/// <reference types="node" />
// Node's own types (node:test, node:assert) for the type check; see
// geometry.desktop.test.ts.

/**
 * Share links on the app's side (milestone 14.6).
 *
 * The parts that can be checked without a screen: what a link looks like and
 * how an id is found in whatever was pasted, when the feature is switched on at
 * all, and every outcome of the server client — against a stubbed `fetch`, so
 * no server is needed. And the one rule the whole feature rests on: whatever
 * the server sends goes through the same import preview as a file from disk,
 * so a tampered download is refused exactly like a tampered file.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { isShareId, shareIdFromInput, shareLinkUrl } from "@/domain/shareLink";
import { previewTimetableFile } from "@/features/timetables/importPipeline";
import { downloadSharedTimetable, shareLinkConfig, uploadSharedTimetable } from "@/util/shareLinkApi";

const ID = "o2Gx0b5cQd2u8rT1yKz3Aw";
const SERVER = "http://localhost:8080";

/** The server's own example file, written by the app's export code. */
const EXAMPLE = readFileSync(
  join(process.cwd(), "server", "src", "main", "resources", "openapi", "example-timetable.temelo"),
  "utf8",
);

/* ------------------------------------------------------------ fetch stub */

type FetchCall = { url: string; init: RequestInit | undefined };

const realFetch = globalThis.fetch;
let calls: FetchCall[] = [];

function stubFetch(answer: (call: FetchCall) => Promise<Response> | Response): void {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init };
    calls.push(call);
    return answer(call);
  }) as typeof fetch;
}

function json(status: number, body: unknown, contentType = "application/json"): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": contentType } });
}

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.EXPO_PUBLIC_TEMELO_SERVER_URL;
  delete process.env.EXPO_PUBLIC_TEMELO_WEB_URL;
});

/* ---------------------------------------------------------------- links */

describe("a share link", () => {
  it("is the web app's /shared/ route with the id", () => {
    assert.equal(shareLinkUrl("https://temelo.example", ID), `https://temelo.example/shared/${ID}`);
  });

  it("has exactly one slash before shared, however the web address ends", () => {
    assert.equal(shareLinkUrl("https://temelo.example/", ID), `https://temelo.example/shared/${ID}`);
    assert.equal(shareLinkUrl("https://host.example/temelo//", ID), `https://host.example/temelo/shared/${ID}`);
  });

  it("recognises an id only in the server's format", () => {
    assert.equal(isShareId(ID), true);
    assert.equal(isShareId(ID.slice(1)), false);
    assert.equal(isShareId(`${ID}A`), false);
    assert.equal(isShareId("o2Gx0b5cQd2u8rT1yKz3A!"), false);
  });
});

describe("finding the id in what was pasted", () => {
  it("accepts a bare id, with stray whitespace", () => {
    assert.equal(shareIdFromInput(`  ${ID}\n`), ID);
  });

  it("accepts a whole link from any host", () => {
    assert.equal(shareIdFromInput(`https://temelo.example/shared/${ID}`), ID);
    assert.equal(shareIdFromInput(`http://localhost:8081/shared/${ID}`), ID);
  });

  it("ignores a query, a fragment or a trailing slash", () => {
    assert.equal(shareIdFromInput(`https://temelo.example/shared/${ID}?utm=chat#top`), ID);
    assert.equal(shareIdFromInput(`https://temelo.example/shared/${ID}/`), ID);
  });

  it("finds the link inside a sentence copied from a chat", () => {
    assert.equal(shareIdFromInput(`Here's my timetable: https://temelo.example/shared/${ID} see you`), ID);
  });

  it("refuses anything that is not a share link", () => {
    assert.equal(shareIdFromInput(""), null);
    assert.equal(shareIdFromInput("hello"), null);
    assert.equal(shareIdFromInput("https://temelo.example/timetable"), null);
    assert.equal(shareIdFromInput(`https://temelo.example/shared/${ID.slice(2)}`), null);
    assert.equal(shareIdFromInput(`https://temelo.example/shared/${ID}XYZ`), null);
  });
});

/* -------------------------------------------------------- configuration */

describe("whether share links are on", () => {
  it("is off with no server configured, so the app stays local", () => {
    process.env.EXPO_PUBLIC_TEMELO_WEB_URL = "https://temelo.example";
    assert.equal(shareLinkConfig(), null);
  });

  it("is off on a phone with a server but no web address to point links at", () => {
    process.env.EXPO_PUBLIC_TEMELO_SERVER_URL = SERVER;
    assert.equal(shareLinkConfig(), null);
  });

  it("is on with both, trailing slashes trimmed", () => {
    process.env.EXPO_PUBLIC_TEMELO_SERVER_URL = `${SERVER}/`;
    process.env.EXPO_PUBLIC_TEMELO_WEB_URL = "https://temelo.example/";
    assert.deepEqual(shareLinkConfig(), { serverUrl: SERVER, webUrl: "https://temelo.example" });
  });

  it("ignores a value that is not an http(s) address", () => {
    process.env.EXPO_PUBLIC_TEMELO_SERVER_URL = "localhost:8080";
    process.env.EXPO_PUBLIC_TEMELO_WEB_URL = "https://temelo.example";
    assert.equal(shareLinkConfig(), null);
  });
});

/* --------------------------------------------------------------- upload */

describe("uploading a file", () => {
  it("posts the text as JSON and returns the id and expiry", async () => {
    stubFetch(() => json(201, { id: ID, expiresAt: "2026-12-08T09:00:00.000Z" }));

    const result = await uploadSharedTimetable(SERVER, EXAMPLE);

    assert.deepEqual(result, { ok: true, id: ID, expiresAt: "2026-12-08T09:00:00.000Z" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${SERVER}/api/shares`);
    assert.equal(calls[0].init?.method, "POST");
    assert.deepEqual(calls[0].init?.headers, { "Content-Type": "application/json" });
    assert.equal(calls[0].init?.body, EXAMPLE);
  });

  it("does not trust an answer without a valid id and expiry", async () => {
    for (const body of [
      { id: "short", expiresAt: "2026-12-08T09:00:00Z" },
      { id: ID, expiresAt: "next week" },
      { id: ID },
      ["not", "an", "object"],
    ]) {
      stubFetch(() => json(201, body));
      const result = await uploadSharedTimetable(SERVER, EXAMPLE);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.failure.kind, "server", JSON.stringify(body));
    }
  });

  it("reports a file over the server's limit as too large", async () => {
    stubFetch(() => json(413, { status: 413, reason: "too-large" }, "application/problem+json"));
    const result = await uploadSharedTimetable(SERVER, EXAMPLE);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.kind, "tooLarge");
  });

  it("reports a refusal as refused, with the reason in the detail", async () => {
    stubFetch(() => json(422, { status: 422, reason: "malformed" }, "application/problem+json"));
    const result = await uploadSharedTimetable(SERVER, EXAMPLE);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failure.kind, "refused");
      assert.match(result.failure.detail, /malformed/);
    }
  });

  it("reports any other answer, even a proxy's HTML page, as a server problem", async () => {
    stubFetch(() => new Response("<html>Bad gateway</html>", { status: 502 }));
    const result = await uploadSharedTimetable(SERVER, EXAMPLE);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.kind, "server");
  });

  it("reports no answer at all as unreachable", async () => {
    stubFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    const result = await uploadSharedTimetable(SERVER, EXAMPLE);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.kind, "unreachable");
  });

  it("gives up after the timeout instead of waiting forever", async () => {
    stubFetch(
      ({ init }) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const result = await uploadSharedTimetable(SERVER, EXAMPLE, 20);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failure.kind, "unreachable");
      assert.match(result.failure.detail, /AbortError/);
    }
  });
});

/* ------------------------------------------------------------- download */

describe("downloading a file", () => {
  it("returns the text exactly as the server sent it", async () => {
    stubFetch(() => new Response(EXAMPLE, { status: 200, headers: { "Content-Type": "application/json" } }));
    const result = await downloadSharedTimetable(SERVER, ID);
    assert.deepEqual(result, { ok: true, text: EXAMPLE });
    assert.equal(calls[0].url, `${SERVER}/api/shares/${ID}`);
    assert.equal(calls[0].init?.method, "GET");
  });

  it("reports an unknown or expired link as not found", async () => {
    stubFetch(() => json(404, { status: 404, reason: "not-found" }, "application/problem+json"));
    const result = await downloadSharedTimetable(SERVER, ID);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.kind, "notFound");
  });

  it("sends no request for something that is not an id", async () => {
    stubFetch(() => {
      throw new Error("must not be called");
    });
    const result = await downloadSharedTimetable(SERVER, "../health");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.kind, "notFound");
    assert.equal(calls.length, 0);
  });

  it("reports a broken server as a server problem", async () => {
    stubFetch(() => new Response("oops", { status: 500 }));
    const result = await downloadSharedTimetable(SERVER, ID);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.kind, "server");
  });
});

/* ------------------------------------------------- the server is not trusted */

describe("what a link downloads", () => {
  it("is previewed like a file: the server's own example imports", () => {
    const preview = previewTimetableFile({ text: EXAMPLE, hasActive: true, existingNames: [] });
    assert.equal(preview.ok, true);
    if (preview.ok) {
      assert.equal(preview.candidate.name, "Winter semester");
      assert.equal(preview.candidate.summary.classCount, 3);
      assert.equal(preview.candidate.destination, "archive");
    }
  });

  it("is refused like a file when it does not hold together, whatever the server let through", () => {
    // Envelope-valid — the server would store it — but a class points at a
    // course that is not there, which only the app's full validator sees.
    const raw = JSON.parse(EXAMPLE);
    raw.timetable.placements[0].courseId = "no-such-course";
    const preview = previewTimetableFile({ text: JSON.stringify(raw), hasActive: true, existingNames: [] });
    assert.equal(preview.ok, false);
    if (!preview.ok) assert.equal(preview.failure.kind, "damaged");
  });
});
