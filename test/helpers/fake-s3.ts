/**
 * A small in-process S3 for the snapshot tests: path-style PUT, GET, HEAD,
 * DELETE, CopyObject, ListObjectsV2, GetBucketVersioning and multipart upload, on a free
 * loopback port. It can play a key that may not delete (403 on DELETE). It
 * checks no signature. The real `createS3` client talks to it over HTTP, so the
 * multipart code runs for real; only the server is a fake.
 */

import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeS3 {
  endpoint: string;
  bucket: string;
  /** Every stored object, by key. */
  objects: Map<string, Buffer>;
  /** Multipart uploads in flight: upload id to its parts. */
  uploads: Map<string, Buffer[]>;
  /** Requests seen, as "METHOD /path?query". */
  log: string[];
  /** Fail the part with this number once with a 500 (0 = none). */
  failPart: number;
  /** Answer a DELETE of an object with this status instead of deleting (0 = delete). 403 plays a key without s3:DeleteObject. */
  deleteStatus: number;
  /** Answer an AbortMultipartUpload with this status instead of aborting (0 = abort). */
  abortStatus: number;
  /** Answer a CopyObject with this status instead of copying (0 = copy). 400 plays a backend that refuses a server-side copy. */
  copyStatus: number;
  /** The `<Status>` text of a `GET ?versioning` answer ("" for none). Used when `versioningStatus` is 0. */
  versioning: string;
  /** Answer `GET ?versioning` with this error status instead (0 = answer 200). Default 501, a backend without the feature. */
  versioningStatus: number;
  stop(): Promise<void>;
}

/** What a test may change on a running fake. */
interface FakeControls {
  failPart: number;
  deleteStatus: number;
  abortStatus: number;
  copyStatus: number;
  versioning: string;
  versioningStatus: number;
}

const DENIED = "<Error><Code>AccessDenied</Code><Message>Access Denied.</Message></Error>";

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    request.on("error", reject);
  });
}

function etagOf(body: Buffer): string {
  return createHash("md5").update(body).digest("hex");
}

function send(response: ServerResponse, status: number, body: string | Buffer = "", headers: Record<string, string> = {}): void {
  response.writeHead(status, { "content-length": String(Buffer.byteLength(body)), ...headers });
  response.end(body);
}

export async function startFakeS3(bucket = "backups"): Promise<FakeS3> {
  const objects = new Map<string, Buffer>();
  const uploads = new Map<string, Buffer[]>();
  const log: string[] = [];
  let nextUpload = 1;
  const state: FakeControls = { failPart: 0, deleteStatus: 0, abortStatus: 0, copyStatus: 0, versioning: "", versioningStatus: 501 };

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    log.push(`${request.method ?? ""} ${url.pathname}${url.search}`);
    const key = decodeURIComponent(url.pathname).slice(`/${bucket}`.length).replace(/^\//u, "");
    const body = await readBody(request);
    const uploadId = url.searchParams.get("uploadId");

    if (request.method === "POST" && url.searchParams.has("uploads")) {
      const id = `upload-${String(nextUpload++)}`;
      uploads.set(id, []);
      send(response, 200, `<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
      return;
    }
    if (request.method === "PUT" && uploadId !== null) {
      const parts = uploads.get(uploadId);
      const number = Number(url.searchParams.get("partNumber"));
      if (parts === undefined) return send(response, 404, "<Error><Code>NoSuchUpload</Code></Error>");
      if (state.failPart === number) {
        state.failPart = 0;
        return send(response, 500, "<Error><Code>InternalError</Code></Error>");
      }
      parts[number - 1] = body;
      return send(response, 200, "", { etag: `"${etagOf(body)}"` });
    }
    if (request.method === "POST" && uploadId !== null) {
      const parts = uploads.get(uploadId);
      if (parts === undefined) return send(response, 404, "<Error><Code>NoSuchUpload</Code></Error>");
      const whole = Buffer.concat(parts);
      objects.set(key, whole);
      uploads.delete(uploadId);
      return send(response, 200, `<CompleteMultipartUploadResult><ETag>"${etagOf(whole)}-${String(parts.length)}"</ETag></CompleteMultipartUploadResult>`);
    }
    if (request.method === "DELETE" && uploadId !== null) {
      if (state.abortStatus !== 0) return send(response, state.abortStatus, DENIED);
      uploads.delete(uploadId);
      return send(response, 204);
    }
    const copySource = request.headers["x-amz-copy-source"]?.toString();
    if (request.method === "PUT" && copySource !== undefined) {
      if (state.copyStatus !== 0) return send(response, state.copyStatus, "<Error><Code>InvalidRequest</Code></Error>");
      const original = objects.get(decodeURIComponent(copySource).slice(`/${bucket}`.length).replace(/^\//u, ""));
      if (original === undefined) return send(response, 404, "<Error><Code>NoSuchKey</Code></Error>");
      objects.set(key, Buffer.from(original));
      return send(response, 200, `<CopyObjectResult><ETag>"${etagOf(original)}"</ETag></CopyObjectResult>`);
    }
    if (request.method === "PUT") {
      objects.set(key, body);
      return send(response, 200, "", { etag: `"${etagOf(body)}"` });
    }
    if (request.method === "GET" && url.searchParams.has("versioning")) {
      if (state.versioningStatus !== 0) return send(response, state.versioningStatus, "<Error><Code>NotImplemented</Code></Error>");
      const status = state.versioning === "" ? "" : `<Status>${state.versioning}</Status>`;
      return send(response, 200, `<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${status}</VersioningConfiguration>`);
    }
    if (request.method === "GET" && url.searchParams.get("list-type") === "2") {
      const prefix = url.searchParams.get("prefix") ?? "";
      const entries = [...objects]
        .filter(([name]) => name.startsWith(prefix))
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([name, data]) => `<Contents><Key>${name}</Key><Size>${String(data.length)}</Size><ETag>"${etagOf(data)}"</ETag></Contents>`);
      return send(response, 200, `<ListBucketResult><IsTruncated>false</IsTruncated>${entries.join("")}</ListBucketResult>`);
    }
    const found = objects.get(key);
    if (request.method === "DELETE") {
      if (state.deleteStatus !== 0) return send(response, state.deleteStatus, state.deleteStatus === 403 ? DENIED : "<Error><Code>InternalError</Code></Error>");
      objects.delete(key);
      return send(response, 204);
    }
    if (found === undefined) return send(response, 404, "<Error><Code>NoSuchKey</Code></Error>");
    if (request.method === "HEAD") {
      response.writeHead(200, { "content-length": String(found.length), etag: `"${etagOf(found)}"` });
      response.end();
      return;
    }
    // The bytes as stored: a string would re-encode anything outside ASCII.
    send(response, 200, found, { etag: `"${etagOf(found)}"` });
  };

  const server: Server = createServer((request, response) => {
    handle(request, response).catch(() => {
      send(response, 500, "<Error><Code>InternalError</Code></Error>");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  // SAFETY: listen(0, host) always gives an AddressInfo, never a pipe path.
  const port = (server.address() as AddressInfo).port;

  return {
    endpoint: `http://127.0.0.1:${String(port)}`,
    bucket,
    objects,
    uploads,
    log,
    get failPart() {
      return state.failPart;
    },
    set failPart(value: number) {
      state.failPart = value;
    },
    get deleteStatus() {
      return state.deleteStatus;
    },
    set deleteStatus(value: number) {
      state.deleteStatus = value;
    },
    get abortStatus() {
      return state.abortStatus;
    },
    set abortStatus(value: number) {
      state.abortStatus = value;
    },
    get copyStatus() {
      return state.copyStatus;
    },
    set copyStatus(value: number) {
      state.copyStatus = value;
    },
    get versioning() {
      return state.versioning;
    },
    set versioning(value: string) {
      state.versioning = value;
    },
    get versioningStatus() {
      return state.versioningStatus;
    },
    set versioningStatus(value: number) {
      state.versioningStatus = value;
    },
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
