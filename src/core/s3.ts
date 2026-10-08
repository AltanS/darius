/**
 * A small S3 client: AWS Signature V4 over `fetch` and WebCrypto.
 *
 * darius has zero runtime dependencies, so there is no AWS SDK. The client
 * speaks only the operations sync, setup and snapshots need (plan-tonight.md,
 * "S3 client operations"): PutObject, GetObject, HeadObject, DeleteObject,
 * ListObjectsV2, HeadBucket, CreateBucket. It works under Bun and Node alike
 * because it touches nothing but the web globals `fetch`, `crypto.subtle`,
 * `TextEncoder` and `AbortSignal`.
 *
 * Wire choices, each deliberate:
 * - Path-style URLs only (`<endpoint>/<bucket>/<key>`). SeaweedFS on the
 *   tailnet has no wildcard DNS, so virtual-hosted style cannot work there.
 * - Every request carries a signed payload hash (`x-amz-content-sha256` is the
 *   real SHA-256, never UNSIGNED-PAYLOAD).
 * - The canonical URI encodes each path segment per RFC 3986 and keeps the
 *   `/` separators. S3 does not normalise paths, so neither do we.
 * - ListObjectsV2 XML is read with a tag scanner, not an XML library.
 * - ETags are returned without their surrounding quotes, from every
 *   operation, so a caller can compare a `put` result with a `list` entry.
 *
 * Since 0.44.0 it also uploads large files in parts (CreateMultipartUpload,
 * UploadPart, CompleteMultipartUpload, AbortMultipartUpload) for snapshots.
 * The caller hands over a `UploadSource` (a size and a read function), so this
 * file still touches no filesystem.
 *
 * GetBucketVersioning (`GET ?versioning`) lets `darius snapshot check` say
 * whether the bucket keeps old versions. A backend without the feature answers
 * 501, 400 or 405; that is `unknown`, never an error.
 *
 * Errors: a 412 on a conditional put is `{ conflict: true }`. A 404 on get or
 * head is `null`. Every other non-2xx throws `S3Error` with the status and the
 * first 300 bytes of the body. A request that got no response at all (refused,
 * DNS, timeout) throws `S3NetworkError`, so sync can tell "offline" from a
 * real failure. Credentials never appear in a message.
 */

/**
 * The `[remote]` table of config.toml.
 *
 * A structural copy of `NonNullable<Config["remote"]>` from
 * `src/core/config.ts` (T2), which did not exist when this file was written.
 * Any value of that type is assignable here.
 */
export interface RemoteConfig {
  endpoint: string;
  bucket: string;
  region: string;
  path_style: boolean;
  allow_http: boolean;
  sse: boolean;
  credentials: string;
}

export interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface ListedObject {
  key: string;
  etag: string;
  size: number;
}

export interface S3 {
  put(
    key: string,
    body: Uint8Array | string,
    o?: { ifNoneMatch?: boolean; contentType?: string },
  ): Promise<{ etag: string } | { conflict: true }>;
  get(key: string): Promise<{ body: Uint8Array; etag: string } | null>;
  head(key: string): Promise<{ etag: string; size: number } | null>;
  del(key: string): Promise<void>;
  list(prefix: string): Promise<ListedObject[]>;
  ensureBucket(): Promise<"exists" | "created">;
}

/** Bytes to upload: a size, and a way to read any range of them. A file reader is one. */
export interface UploadSource {
  size: number;
  /** Exactly `length` bytes from `offset`; throws when the source cannot give them. */
  read(offset: number, length: number): Promise<Uint8Array>;
}

export interface UploadOptions {
  /** Bytes per part of a multipart upload. At least 5 MiB; raised when the source would need more than 10 000 parts. */
  partSize?: number;
  contentType?: string;
  /**
   * Called when a failed multipart upload could not be aborted (the key may lack
   * `s3:AbortMultipartUpload`). The upload still throws its own error; this only explains the leftover parts.
   */
  onAbortFailed?: (message: string) => void;
}

/**
 * Uploads a source of any size without holding it all in memory: one PUT when it fits in a
 * part, else a multipart upload (create, one request per part, complete; abort on failure).
 * Kept apart from `S3` so the sync code and its test fakes need no change.
 */
export interface S3Upload {
  upload(key: string, source: UploadSource, options?: UploadOptions): Promise<{ etag: string; size: number; parts: number }>;
}

/** Kept apart from `S3`, like `S3Upload`. A server-side copy: the bytes never leave the bucket. */
export interface S3Copy {
  /** CopyObject from one key to another in this bucket. AWS allows a source of up to 5 GB; a larger one fails with 400. */
  copy(from: string, to: string): Promise<void>;
}

/** Whether the bucket keeps old versions. `off` means it never had versioning; `unknown` means the backend does not say. */
export type BucketVersioning = "enabled" | "suspended" | "off" | "unknown";

/** Kept apart from `S3`, like `S3Upload`, so the sync code and its fakes need no change. */
export interface S3Versioning {
  getBucketVersioning(): Promise<BucketVersioning>;
}

/** Statuses of a backend that has no versioning API: the state is `unknown`, not an error. */
const NO_VERSIONING_API: ReadonlySet<number> = new Set([400, 405, 501]);

/** The server answered with a status the caller did not expect. */
export class S3Error extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "S3Error";
    this.status = status;
  }
}

/** No HTTP response came back: connection refused, DNS failure, or timeout. */
export class S3NetworkError extends Error {
  constructor(message: string, options: ErrorOptions) {
    super(message, options);
    this.name = "S3NetworkError";
  }
}

const SERVICE = "s3";
const ALGORITHM = "AWS4-HMAC-SHA256";
const REQUEST_TIMEOUT_MS = 30_000;
const ERROR_BODY_BYTES = 300;
/** 10 000 pages of 1000 keys. A prefix that large is a bug, not a store. */
const MAX_LIST_PAGES = 10_000;
const SSE_ALGORITHM = "AES256";
/** A part is up to 16 MiB and the link may be slow: a part gets five minutes. */
const PART_TIMEOUT_MS = 300_000;
const DEFAULT_PART_SIZE = 16 * 1024 * 1024;
const MIN_PART_SIZE = 5 * 1024 * 1024;
const MAX_PARTS = 10_000;
const PART_ATTEMPTS = 3;

const encoder = new TextEncoder();

type HeaderPair = readonly [name: string, value: string];
type QueryPair = readonly [name: string, value: string];
type Method = "GET" | "PUT" | "POST" | "HEAD" | "DELETE";

// ---------------------------------------------------------------------------
// Signature V4, pure apart from WebCrypto being async.
// ---------------------------------------------------------------------------

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(data: Uint8Array<ArrayBuffer>): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", data));
}

async function hmac(key: ArrayBuffer | Uint8Array<ArrayBuffer>, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
}

/**
 * RFC 3986 percent-encoding: everything except `A-Z a-z 0-9 - . _ ~`.
 * `encodeURIComponent` leaves `! ' ( ) *` alone, which SigV4 does not.
 */
export function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** `/<bucket>/<key>` with every segment encoded and the `/` separators kept. */
export function canonicalPath(bucket: string, key?: string): string {
  const bucketPath = `/${encodeRfc3986(bucket)}`;
  if (key === undefined) return bucketPath;
  return `${bucketPath}/${key.split("/").map(encodeRfc3986).join("/")}`;
}

/** Encoded `name=value` pairs sorted by name, then value. An empty value keeps its `=`. */
export function canonicalQuery(pairs: readonly QueryPair[]): string {
  return pairs
    .map(([name, value]) => [encodeRfc3986(name), encodeRfc3986(value)] as const)
    .toSorted(([nameA, valueA], [nameB, valueB]) => {
      if (nameA !== nameB) return nameA < nameB ? -1 : 1;
      if (valueA === valueB) return 0;
      return valueA < valueB ? -1 : 1;
    })
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
}

export interface UnsignedRequest {
  method: string;
  /** Already canonical, as returned by `canonicalPath`. */
  path: string;
  /** Already canonical, as returned by `canonicalQuery`. */
  query: string;
  /** Every header to sign. Must include `host`, `x-amz-date` and `x-amz-content-sha256`. */
  headers: readonly HeaderPair[];
  payloadHash: string;
  /** `YYYYMMDDTHHMMSSZ`, the same value as the `x-amz-date` header. */
  amzDate: string;
  region: string;
}

/** The `Authorization` header value for one request. */
export async function authorizationHeader(request: UnsignedRequest, credentials: Credentials): Promise<string> {
  const headers = request.headers
    .map(([name, value]) => [name.toLowerCase(), value.trim().replace(/\s+/g, " ")] as const)
    .toSorted(([nameA], [nameB]) => (nameA < nameB ? -1 : 1));
  const signedHeaders = headers.map(([name]) => name).join(";");
  const canonicalRequest = [
    request.method,
    request.path,
    request.query,
    headers.map(([name, value]) => `${name}:${value}\n`).join(""),
    signedHeaders,
    request.payloadHash,
  ].join("\n");

  const day = request.amzDate.slice(0, 8);
  const scope = `${day}/${request.region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, request.amzDate, scope, await sha256Hex(encoder.encode(canonicalRequest))].join(
    "\n",
  );

  const dateKey = await hmac(encoder.encode(`AWS4${credentials.secretAccessKey}`), day);
  const regionKey = await hmac(dateKey, request.region);
  const serviceKey = await hmac(regionKey, SERVICE);
  const signingKey = await hmac(serviceKey, "aws4_request");
  const signature = toHex(await hmac(signingKey, stringToSign));

  return `${ALGORITHM} Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

/** `2026-09-28T03:14:15.123Z` becomes `20260928T031415Z`. */
export function amzDateOf(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// ---------------------------------------------------------------------------
// ListObjectsV2 XML, read with a tag scanner.
// ---------------------------------------------------------------------------

const XML_ENTITIES: ReadonlyMap<string, string> = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
]);

function decodeXmlText(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (whole, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return XML_ENTITIES.get(entity) ?? whole;
  });
}

/** The raw inner text of every `<tag>...</tag>` in `xml`, in order. */
function innerTexts(xml: string, tag: string): string[] {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const found: string[] = [];
  let cursor = 0;
  // Each pass consumes at least one character, so xml.length bounds the loop.
  for (let pass = 0; pass <= xml.length; pass += 1) {
    const start = xml.indexOf(open, cursor);
    if (start === -1) break;
    const end = xml.indexOf(close, start + open.length);
    if (end === -1) throw new Error(`S3 list: unterminated <${tag}> in response`);
    found.push(xml.slice(start + open.length, end));
    cursor = end + close.length;
  }
  return found;
}

function firstText(xml: string, tag: string): string | undefined {
  const [first] = innerTexts(xml, tag);
  return first === undefined ? undefined : decodeXmlText(first);
}

function unquote(etag: string): string {
  return etag.replace(/^"(.*)"$/, "$1");
}

export interface ListPage {
  objects: ListedObject[];
  nextToken?: string;
}

/** One ListObjectsV2 response body. Throws when it is truncated but names no next token. */
export function parseListPage(xml: string): ListPage {
  const objects = innerTexts(xml, "Contents").map((contents) => {
    const key = firstText(contents, "Key");
    const size = Number(firstText(contents, "Size"));
    if (key === undefined || !Number.isSafeInteger(size)) {
      throw new Error("S3 list: a <Contents> entry has no <Key> or no integer <Size>");
    }
    return { key, etag: unquote(firstText(contents, "ETag") ?? ""), size };
  });
  // Only the top-level flag: strip the entries so nothing inside them can match.
  const isTruncated = firstText(xml.replace(/<Contents>[\s\S]*?<\/Contents>/g, ""), "IsTruncated") === "true";
  if (!isTruncated) return { objects };
  const nextToken = firstText(xml, "NextContinuationToken");
  if (nextToken === undefined || nextToken === "") {
    throw new Error("S3 list: IsTruncated is true but NextContinuationToken is missing");
  }
  return { objects, nextToken };
}

/** One GetBucketVersioning answer. No `<Status>` means versioning was never turned on. */
export function parseVersioning(xml: string): BucketVersioning {
  const status = firstText(xml, "Status");
  if (status === undefined || status === "") return "off";
  if (status === "Enabled") return "enabled";
  return status === "Suspended" ? "suspended" : "unknown";
}

// ---------------------------------------------------------------------------
// The client.
// ---------------------------------------------------------------------------

interface RequestSpec {
  method: Method;
  key?: string;
  query?: readonly QueryPair[];
  body?: Uint8Array<ArrayBuffer>;
  headers?: readonly HeaderPair[];
  timeoutMs?: number;
}

function bytesOf(body: Uint8Array | string): Uint8Array<ArrayBuffer> {
  // A copy, so the hash and the upload see the same bytes even if the caller
  // mutates its buffer, and so the type is backed by a plain ArrayBuffer.
  return body instanceof Uint8Array ? new Uint8Array(body) : encoder.encode(body);
}

function createBucketBody(region: string): Uint8Array<ArrayBuffer> {
  // us-east-1 is the default and AWS rejects it as an explicit constraint.
  if (region === "us-east-1") return new Uint8Array(0);
  return encoder.encode(
    `<CreateBucketConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><LocationConstraint>${region}</LocationConstraint></CreateBucketConfiguration>`,
  );
}

function parseEndpoint(remote: RemoteConfig): URL {
  const url = new URL(remote.endpoint);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`S3 endpoint must be http or https: ${remote.endpoint}`);
  }
  if (url.protocol === "http:" && !remote.allow_http) {
    throw new Error(`S3 endpoint ${remote.endpoint} is plain http, but allow_http is false`);
  }
  if (url.search !== "" || url.hash !== "") {
    throw new Error(`S3 endpoint must not carry a query or fragment: ${remote.endpoint}`);
  }
  return url;
}

function requireKey(key: string): void {
  if (key === "") throw new Error("S3: object key is empty");
}

export function createS3(cfg: RemoteConfig, creds: Credentials): S3 & S3Upload & S3Versioning & S3Copy {
  if (!cfg.path_style) throw new Error("S3: only path-style addressing is supported; set path_style = true");
  if (cfg.bucket === "") throw new Error("S3: bucket is empty");
  if (creds.accessKeyId === "" || creds.secretAccessKey === "") throw new Error("S3: credentials are empty");
  const endpoint = parseEndpoint(cfg);
  const basePath = endpoint.pathname.replace(/\/+$/, "");

  function redact(text: string): string {
    return text.replaceAll(creds.secretAccessKey, "<redacted>").replaceAll(creds.accessKeyId, "<redacted>");
  }

  async function send(spec: RequestSpec): Promise<Response> {
    const body = spec.body ?? new Uint8Array(0);
    const payloadHash = await sha256Hex(body);
    const amzDate = amzDateOf(new Date());
    const path = `${basePath}${canonicalPath(cfg.bucket, spec.key)}`;
    const query = canonicalQuery(spec.query ?? []);
    const headers: HeaderPair[] = [
      ["x-amz-content-sha256", payloadHash],
      ["x-amz-date", amzDate],
      ...(spec.headers ?? []),
    ];
    const authorization = await authorizationHeader(
      { method: spec.method, path, query, headers: [["host", endpoint.host], ...headers], payloadHash, amzDate, region: cfg.region },
      creds,
    );
    // `fetch` sets Host itself from the URL; it is signed above with the same value.
    const requestHeaders = new Headers();
    for (const [name, value] of headers) requestHeaders.set(name, value);
    requestHeaders.set("authorization", authorization);
    const url = `${endpoint.origin}${path}${query === "" ? "" : `?${query}`}`;
    try {
      return await fetch(url, {
        method: spec.method,
        headers: requestHeaders,
        body: spec.method === "PUT" || spec.method === "POST" ? body : undefined,
        signal: AbortSignal.timeout(spec.timeoutMs ?? REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new S3NetworkError(`S3 ${spec.method} ${spec.key ?? cfg.bucket}: no response from ${endpoint.origin}`, {
        cause: error,
      });
    }
  }

  async function failure(response: Response, spec: RequestSpec): Promise<S3Error> {
    const bytes = new Uint8Array(await response.arrayBuffer()).subarray(0, ERROR_BODY_BYTES);
    const snippet = redact(new TextDecoder().decode(bytes));
    const target = spec.key ?? cfg.bucket;
    return new S3Error(`S3 ${spec.method} ${target}: HTTP ${response.status} ${snippet}`.trimEnd(), response.status);
  }

  function etagOf(response: Response, spec: RequestSpec): string {
    const etag = response.headers.get("etag");
    if (etag === null) throw new S3Error(`S3 ${spec.method} ${spec.key ?? cfg.bucket}: response has no ETag`, response.status);
    return unquote(etag);
  }

  async function listPage(prefix: string, token: string | undefined): Promise<ListPage> {
    const query: QueryPair[] = [
      ["list-type", "2"],
      ["prefix", prefix],
    ];
    if (token !== undefined) query.push(["continuation-token", token]);
    const spec: RequestSpec = { method: "GET", query };
    const response = await send(spec);
    if (!response.ok) throw await failure(response, spec);
    return parseListPage(await response.text());
  }

  /** The part size for a source: the asked one, never under 5 MiB, large enough for 10 000 parts. */
  function partSizeFor(size: number, asked: number | undefined): number {
    const wanted = Math.max(asked ?? DEFAULT_PART_SIZE, MIN_PART_SIZE);
    const mebibyte = 1024 * 1024;
    return Math.max(wanted, Math.ceil(size / MAX_PARTS / mebibyte) * mebibyte);
  }

  async function startMultipart(key: string, contentType: string | undefined): Promise<string> {
    const headers: HeaderPair[] = [];
    if (contentType !== undefined) headers.push(["content-type", contentType]);
    if (cfg.sse) headers.push(["x-amz-server-side-encryption", SSE_ALGORITHM]);
    const spec: RequestSpec = { method: "POST", key, query: [["uploads", ""]], headers };
    const response = await send(spec);
    if (!response.ok) throw await failure(response, spec);
    const uploadId = firstText(await response.text(), "UploadId");
    if (uploadId === undefined || uploadId === "") throw new S3Error(`S3 POST ${key}: the answer has no UploadId`, response.status);
    return uploadId;
  }

  async function uploadPart(key: string, uploadId: string, number: number, body: Uint8Array<ArrayBuffer>): Promise<string> {
    const spec: RequestSpec = {
      method: "PUT",
      key,
      query: [
        ["partNumber", String(number)],
        ["uploadId", uploadId],
      ],
      body,
      timeoutMs: PART_TIMEOUT_MS,
    };
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= PART_ATTEMPTS; attempt += 1) {
      try {
        const response = await send(spec);
        if (response.ok) {
          await response.body?.cancel();
          return etagOf(response, spec);
        }
        lastError = await failure(response, spec);
      } catch (error) {
        if (!(error instanceof S3NetworkError)) throw error;
        lastError = error;
        continue;
      }
      // A 4xx will not change on a second try.
      if (lastError instanceof S3Error && lastError.status < 500) throw lastError;
    }
    throw lastError ?? new Error(`S3 PUT ${key}: part ${number} failed`);
  }

  async function completeMultipart(key: string, uploadId: string, etags: readonly string[]): Promise<string> {
    const parts = etags.map((etag, index) => `<Part><PartNumber>${index + 1}</PartNumber><ETag>"${etag}"</ETag></Part>`).join("");
    const spec: RequestSpec = {
      method: "POST",
      key,
      query: [["uploadId", uploadId]],
      body: encoder.encode(`<CompleteMultipartUpload>${parts}</CompleteMultipartUpload>`),
      headers: [["content-type", "application/xml"]],
      timeoutMs: PART_TIMEOUT_MS,
    };
    const response = await send(spec);
    if (!response.ok) throw await failure(response, spec);
    const text = await response.text();
    // S3 may answer 200 and still carry an <Error> in the body.
    if (text.includes("<Error>")) throw new S3Error(`S3 POST ${key}: ${redact(text.slice(0, ERROR_BODY_BYTES))}`, response.status);
    return unquote(firstText(text, "ETag") ?? "");
  }

  /** Never throws: the upload is already failing. A refusal is reported through `onFailed`; a part left behind is the lifecycle rule's to clean up. */
  async function abortMultipart(key: string, uploadId: string, onFailed: ((message: string) => void) | undefined): Promise<void> {
    let problem: string | null = null;
    try {
      const response = await send({ method: "DELETE", key, query: [["uploadId", uploadId]] });
      await response.body?.cancel();
      if (!response.ok) problem = `HTTP ${String(response.status)}`;
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
    if (problem === null || onFailed === undefined) return;
    onFailed(
      `the failed upload of ${key} could not be aborted (${problem}): its parts stay in the bucket. Give the key s3:AbortMultipartUpload, or let a lifecycle rule with AbortIncompleteMultipartUpload remove them`,
    );
  }

  return {
    async put(key, body, o = {}) {
      requireKey(key);
      const headers: HeaderPair[] = [];
      if (o.contentType !== undefined) headers.push(["content-type", o.contentType]);
      if (o.ifNoneMatch === true) headers.push(["if-none-match", "*"]);
      if (cfg.sse) headers.push(["x-amz-server-side-encryption", SSE_ALGORITHM]);
      const spec: RequestSpec = { method: "PUT", key, body: bytesOf(body), headers };
      const response = await send(spec);
      if (response.status === 412 && o.ifNoneMatch === true) {
        await response.body?.cancel();
        return { conflict: true };
      }
      if (!response.ok) throw await failure(response, spec);
      await response.body?.cancel();
      return { etag: etagOf(response, spec) };
    },

    async upload(key, source, options = {}) {
      requireKey(key);
      const { size } = source;
      const partSize = partSizeFor(size, options.partSize);
      if (size <= partSize) {
        const result = await this.put(key, await source.read(0, size), { contentType: options.contentType });
        if ("conflict" in result) throw new S3Error(`S3 PUT ${key}: unexpected conflict`, 412);
        return { etag: result.etag, size, parts: 1 };
      }
      const uploadId = await startMultipart(key, options.contentType);
      try {
        const etags: string[] = [];
        for (let offset = 0; offset < size; offset += partSize) {
          const part = bytesOf(await source.read(offset, Math.min(partSize, size - offset)));
          etags.push(await uploadPart(key, uploadId, etags.length + 1, part));
        }
        return { etag: await completeMultipart(key, uploadId, etags), size, parts: etags.length };
      } catch (error) {
        await abortMultipart(key, uploadId, options.onAbortFailed);
        throw error;
      }
    },

    async copy(from, to) {
      requireKey(from);
      requireKey(to);
      const headers: HeaderPair[] = [["x-amz-copy-source", canonicalPath(cfg.bucket, from)]];
      if (cfg.sse) headers.push(["x-amz-server-side-encryption", SSE_ALGORITHM]);
      const spec: RequestSpec = { method: "PUT", key: to, headers, timeoutMs: PART_TIMEOUT_MS };
      const response = await send(spec);
      if (!response.ok) throw await failure(response, spec);
      // S3 may answer 200 and then put an <Error> in the body.
      const text = await response.text();
      if (text.includes("<Error>")) throw new S3Error(`S3 PUT ${to}: copy failed ${redact(text.slice(0, ERROR_BODY_BYTES))}`, 500);
    },

    async get(key) {
      requireKey(key);
      const spec: RequestSpec = { method: "GET", key };
      const response = await send(spec);
      if (response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      if (!response.ok) throw await failure(response, spec);
      const etag = etagOf(response, spec);
      return { body: new Uint8Array(await response.arrayBuffer()), etag };
    },

    async head(key) {
      requireKey(key);
      const spec: RequestSpec = { method: "HEAD", key };
      const response = await send(spec);
      if (response.status === 404) return null;
      if (!response.ok) throw await failure(response, spec);
      const size = Number(response.headers.get("content-length"));
      if (!Number.isSafeInteger(size)) throw new S3Error(`S3 HEAD ${key}: no integer Content-Length`, response.status);
      return { etag: etagOf(response, spec), size };
    },

    async del(key) {
      requireKey(key);
      const spec: RequestSpec = { method: "DELETE", key };
      const response = await send(spec);
      if (!response.ok) throw await failure(response, spec);
      await response.body?.cancel();
    },

    async list(prefix) {
      const objects: ListedObject[] = [];
      let token: string | undefined;
      for (let page = 1; page <= MAX_LIST_PAGES; page += 1) {
        const result = await listPage(prefix, token);
        objects.push(...result.objects);
        if (result.nextToken === undefined) return objects;
        token = result.nextToken;
      }
      throw new Error(`S3 list ${prefix}: more than ${MAX_LIST_PAGES} pages`);
    },

    async getBucketVersioning() {
      const spec: RequestSpec = { method: "GET", query: [["versioning", ""]] };
      const response = await send(spec);
      if (NO_VERSIONING_API.has(response.status)) {
        await response.body?.cancel();
        return "unknown";
      }
      if (!response.ok) throw await failure(response, spec);
      return parseVersioning(await response.text());
    },

    async ensureBucket() {
      const headSpec: RequestSpec = { method: "HEAD" };
      const head = await send(headSpec);
      if (head.ok) return "exists";
      if (head.status !== 404) throw await failure(head, headSpec);

      const createSpec: RequestSpec = { method: "PUT", body: createBucketBody(cfg.region) };
      const created = await send(createSpec);
      if (created.ok) {
        await created.body?.cancel();
        return "created";
      }
      const error = await failure(created, createSpec);
      // A concurrent setup created it between our HEAD and PUT.
      if (created.status === 409 && error.message.includes("BucketAlreadyOwnedByYou")) return "exists";
      throw error;
    },
  };
}
