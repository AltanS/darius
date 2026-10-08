/**
 * The S3 client: SigV4 against AWS's published vectors, the pure encoders and
 * the XML scanner, then every operation against a real SeaweedFS container.
 *
 * The container tests skip loudly when podman or the pinned image is missing;
 * that is an inconclusive environment, not a pass.
 */

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import {
  amzDateOf,
  authorizationHeader,
  canonicalPath,
  canonicalQuery,
  createS3,
  parseListPage,
  parseVersioning,
  S3Error,
  S3NetworkError,
  type RemoteConfig,
} from "../src/core/s3.ts";
import { startFakeS3 } from "./helpers/fake-s3.ts";
import { isAddressInfo, seaweedfsUnavailable, startSeaweedFs, type SeaweedFs } from "./helpers/seaweedfs.ts";

// AWS's documented example identity (Signature V4 examples for S3). Not a secret.
const AWS_EXAMPLE = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function remoteFor(endpoint: string): RemoteConfig {
  return {
    endpoint,
    bucket: "b",
    region: "us-east-1",
    path_style: true,
    allow_http: true,
    sse: true,
    credentials: "(test)",
  };
}

function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

interface Exchange {
  method: string;
  url: string;
  status: number;
  sse: string | null;
}

/** Run `fn` with `fetch` recording every request, then restore it. */
async function recordFetch<R>(fn: () => Promise<R>): Promise<{ result: R; exchanges: Exchange[] }> {
  const realFetch = globalThis.fetch;
  const exchanges: Exchange[] = [];
  const recording: typeof fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    const response = await realFetch(input, init);
    exchanges.push({
      method: init?.method ?? "GET",
      url: String(input),
      status: response.status,
      sse: response.headers.get("x-amz-server-side-encryption"),
    });
    return response;
  }, realFetch);
  globalThis.fetch = recording;
  try {
    return { result: await fn(), exchanges };
  } finally {
    globalThis.fetch = realFetch;
  }
}

describe("SigV4 against the AWS S3 documentation vectors", () => {
  test("GET Object with a Range header", async () => {
    const authorization = await authorizationHeader(
      {
        method: "GET",
        path: "/test.txt",
        query: "",
        headers: [
          ["host", "examplebucket.s3.amazonaws.com"],
          ["range", "bytes=0-9"],
          ["x-amz-content-sha256", EMPTY_SHA256],
          ["x-amz-date", "20130524T000000Z"],
        ],
        payloadHash: EMPTY_SHA256,
        amzDate: "20130524T000000Z",
        region: "us-east-1",
      },
      AWS_EXAMPLE,
    );
    assert.equal(
      authorization,
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
        "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });

  test("GET Bucket (list) with a query string, sorted canonically", async () => {
    const authorization = await authorizationHeader(
      {
        method: "GET",
        path: "/",
        query: canonicalQuery([
          ["prefix", "J"],
          ["max-keys", "2"],
        ]),
        headers: [
          ["host", "examplebucket.s3.amazonaws.com"],
          ["x-amz-content-sha256", EMPTY_SHA256],
          ["x-amz-date", "20130524T000000Z"],
        ],
        payloadHash: EMPTY_SHA256,
        amzDate: "20130524T000000Z",
        region: "us-east-1",
      },
      AWS_EXAMPLE,
    );
    assert.match(authorization, /Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7$/);
  });
});

describe("canonical encoding", () => {
  test("each path segment is RFC 3986 encoded and the slashes are kept", () => {
    assert.equal(canonicalPath("bkt", "a b/c+d=é!*'()~/x"), "/bkt/a%20b/c%2Bd%3D%C3%A9%21%2A%27%28%29~/x");
  });

  test("a bucket path has no trailing slash", () => {
    assert.equal(canonicalPath("darius"), "/darius");
  });

  test("the query is sorted by encoded name and an empty value keeps its =", () => {
    assert.equal(
      canonicalQuery([
        ["prefix", ""],
        ["list-type", "2"],
        ["continuation-token", "a+b/c="],
      ]),
      "continuation-token=a%2Bb%2Fc%3D&list-type=2&prefix=",
    );
  });

  test("x-amz-date drops separators and milliseconds", () => {
    assert.equal(amzDateOf(new Date("2026-09-28T03:14:15.123Z")), "20260928T031415Z");
  });
});

describe("ListObjectsV2 tag scanner", () => {
  test("reads keys, unquoted etags, sizes and the continuation token, decoding entities", () => {
    const page = parseListPage(
      `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>b</Name>` +
        `<Contents><Key>p/a&amp;b&lt;c&#233;</Key><ETag>&quot;abc&quot;</ETag><Size>5</Size></Contents>` +
        `<Contents><Key>p/z</Key><ETag>"def"</ETag><Size>0</Size></Contents>` +
        `<IsTruncated>true</IsTruncated><NextContinuationToken>tok&amp;en</NextContinuationToken></ListBucketResult>`,
    );
    assert.deepEqual(page, {
      objects: [
        { key: "p/a&b<cé", etag: "abc", size: 5 },
        { key: "p/z", etag: "def", size: 0 },
      ],
      nextToken: "tok&en",
    });
  });

  test("an empty, untruncated page has no token", () => {
    assert.deepEqual(parseListPage("<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>"), {
      objects: [],
    });
  });

  test("truncated without a token is an error, not an endless loop", () => {
    assert.throws(() => parseListPage("<ListBucketResult><IsTruncated>true</IsTruncated></ListBucketResult>"), /NextContinuationToken/);
  });
});

describe("GetBucketVersioning", () => {
  const NS = 'xmlns="http://s3.amazonaws.com/doc/2006-03-01/"';

  test("the three answers: Enabled, Suspended, and no Status (never turned on)", () => {
    assert.equal(parseVersioning(`<VersioningConfiguration ${NS}><Status>Enabled</Status></VersioningConfiguration>`), "enabled");
    assert.equal(parseVersioning(`<VersioningConfiguration ${NS}><Status>Suspended</Status><MfaDelete>Disabled</MfaDelete></VersioningConfiguration>`), "suspended");
    assert.equal(parseVersioning(`<VersioningConfiguration ${NS}></VersioningConfiguration>`), "off");
    assert.equal(parseVersioning(`<VersioningConfiguration ${NS}/>`), "off");
    assert.equal(parseVersioning(`<VersioningConfiguration ${NS}><Status>Sideways</Status></VersioningConfiguration>`), "unknown");
  });

  test("a backend without the feature (400, 405, 501) is unknown; any other error status throws", async () => {
    const fake = await startFakeS3();
    try {
      const s3 = createS3({ ...remoteFor(fake.endpoint), bucket: fake.bucket, sse: false }, AWS_EXAMPLE);
      for (const status of [400, 405, 501]) {
        fake.versioningStatus = status;
        assert.equal(await s3.getBucketVersioning(), "unknown", String(status));
      }
      fake.versioningStatus = 0;
      fake.versioning = "Enabled";
      assert.equal(await s3.getBucketVersioning(), "enabled");
      fake.versioning = "";
      assert.equal(await s3.getBucketVersioning(), "off");
      fake.versioningStatus = 403;
      await assert.rejects(s3.getBucketVersioning(), { name: "S3Error", status: 403 });
      assert.ok(fake.log.every((line) => !line.startsWith("GET") || line.includes("versioning")), fake.log.join("\n"));
    } finally {
      await fake.stop();
    }
  });
});

describe("createS3 refuses what it cannot do safely", () => {
  test("virtual-hosted addressing", () => {
    assert.throws(() => createS3({ ...remoteFor("http://127.0.0.1:1"), path_style: false }, AWS_EXAMPLE), /path-style/);
  });

  test("plain http without allow_http", () => {
    assert.throws(() => createS3({ ...remoteFor("http://127.0.0.1:1"), allow_http: false }, AWS_EXAMPLE), /allow_http/);
  });

  test("a closed port is a network error, not an HTTP one", async () => {
    const port = await new Promise<number>((resolve) => {
      const server = createServer().listen(0, "127.0.0.1", () => {
        const address = server.address();
        server.close(() => resolve(isAddressInfo(address) ? address.port : 1));
      });
    });
    const s3 = createS3(remoteFor(`http://127.0.0.1:${port}`), AWS_EXAMPLE);
    await assert.rejects(s3.head("k"), S3NetworkError);
  });
});

const unavailable = await seaweedfsUnavailable();
if (unavailable !== null) console.error(`\n!!! SKIPPED: S3 tests against SeaweedFS: ${unavailable}\n`);

describe("against a real SeaweedFS", { skip: unavailable ?? false }, () => {
  let server: SeaweedFs;

  before(async () => {
    server = await startSeaweedFs();
  });

  after(async () => {
    await server.stop();
  });

  test("a conditional put succeeds once, then returns {conflict: true} and leaves the object alone", async () => {
    const first = await server.s3.put("cond/one", "first", { ifNoneMatch: true });
    assert.ok("etag" in first && first.etag.length > 0);
    const second = await server.s3.put("cond/one", "second", { ifNoneMatch: true });
    assert.deepEqual(second, { conflict: true });
    const stored = await server.s3.get("cond/one");
    assert.equal(stored === null ? null : text(stored.body), "first");
  });

  test("the conditional put status on the wire is exactly 412", async () => {
    await server.s3.put("cond/wire", "x", { ifNoneMatch: true });
    const { exchanges } = await recordFetch(() => server.s3.put("cond/wire", "y", { ifNoneMatch: true }));
    assert.deepEqual(
      exchanges.map((exchange) => exchange.status),
      [412],
    );
  });

  test("16 racing conditional puts on one key have exactly one winner", async () => {
    const results = await Promise.all(
      Array.from({ length: 16 }, (_, index) => server.s3.put("cond/race", `writer ${index}`, { ifNoneMatch: true })),
    );
    assert.equal(results.filter((result) => "etag" in result).length, 1);
  });

  test("a plain put overwrites", async () => {
    await server.s3.put("plain/k", "one");
    await server.s3.put("plain/k", "two", { contentType: "text/plain" });
    const stored = await server.s3.get("plain/k");
    assert.equal(stored === null ? null : text(stored.body), "two");
  });

  test("list pages over 1200 keys with continuation tokens", async () => {
    const keys = Array.from({ length: 1200 }, (_, index) => `page/${String(index).padStart(4, "0")}`);
    for (let start = 0; start < keys.length; start += 50) {
      await Promise.all(keys.slice(start, start + 50).map((key) => server.s3.put(key, key)));
    }
    const { result, exchanges } = await recordFetch(() => server.s3.list("page/"));
    const listRequests = exchanges.filter((exchange) => exchange.url.includes("list-type=2"));
    assert.ok(listRequests.length >= 2, `expected at least 2 list pages, saw ${listRequests.length}`);
    assert.ok(
      listRequests.slice(1).every((exchange) => exchange.url.includes("continuation-token=")),
      "every page after the first carries a continuation token",
    );
    assert.deepEqual(
      result.map((object) => object.key),
      keys,
    );
    assert.ok(result.every((object) => object.size === 9));
  });

  test("a listed etag equals the etag the put returned", async () => {
    const put = await server.s3.put("etag/k", "content");
    const [listed] = await server.s3.list("etag/");
    assert.ok("etag" in put);
    assert.equal(listed?.etag, put.etag);
  });

  test("the SSE header is accepted with the KEK configured and echoed back", async () => {
    const { result, exchanges } = await recordFetch(() => server.s3.put("sse/k", "secret-ish"));
    assert.ok("etag" in result);
    assert.equal(exchanges[0]?.sse, "AES256");
  });

  test("head and get on a missing key return null", async () => {
    assert.equal(await server.s3.head("missing/nothing-here"), null);
    assert.equal(await server.s3.get("missing/nothing-here"), null);
  });

  test("head reports size and etag; delete removes; deleting again is fine", async () => {
    const put = await server.s3.put("del/k", "12345");
    assert.ok("etag" in put);
    assert.deepEqual(await server.s3.head("del/k"), { etag: put.etag, size: 5 });
    await server.s3.del("del/k");
    assert.equal(await server.s3.head("del/k"), null);
    await server.s3.del("del/k");
  });

  test("keys with spaces, plus, equals, unicode and sub-delims round-trip through put, get and list", async () => {
    const keys = ["odd/a b", "odd/c+d=e", "odd/é ü", "odd/!*'()", "odd/x~y.z-_", "odd/deep/er/key"];
    for (const key of keys) await server.s3.put(key, key);
    for (const key of keys) {
      const stored = await server.s3.get(key);
      assert.equal(stored === null ? null : text(stored.body), key);
    }
    assert.deepEqual(
      (await server.s3.list("odd/")).map((object) => object.key).toSorted(),
      keys.toSorted(),
    );
  });

  test("ensureBucket reports an existing bucket, and creates a new one", async () => {
    assert.equal(await server.s3.ensureBucket(), "exists");
    const fresh = createS3({ ...server.remote, bucket: "darius-fresh" }, server.credentials);
    assert.equal(await fresh.ensureBucket(), "created");
    assert.equal(await fresh.ensureBucket(), "exists");
  });

  test("a wrong secret throws with the status, and the message holds no credential", async () => {
    const wrong = { accessKeyId: server.credentials.accessKeyId, secretAccessKey: "not-the-secret-value" };
    const s3 = createS3(server.remote, wrong);
    await assert.rejects(s3.put("auth/k", "x"), (error: Error) => {
      assert.ok(error instanceof S3Error);
      assert.equal(error.status, 403);
      assert.match(error.message, /HTTP 403/);
      assert.ok(!error.message.includes(wrong.secretAccessKey));
      assert.ok(!error.message.includes(wrong.accessKeyId));
      return true;
    });
  });
});

describe("against a SeaweedFS with no SSE key", { skip: unavailable ?? false }, () => {
  let server: SeaweedFs;

  before(async () => {
    server = await startSeaweedFs({ sseKek: false });
  });

  after(async () => {
    await server.stop();
  });

  test("an SSE put throws with status 500, so a missing KEK is loud", async () => {
    await assert.rejects(server.s3.put("sse/k", "x"), (error: Error) => {
      assert.ok(error instanceof S3Error);
      assert.equal(error.status, 500);
      return true;
    });
  });
});
