/**
 * A small in-process S3 for the snapshot tests: path-style PUT, GET, HEAD,
 * DELETE, ListObjectsV2 and multipart upload, on a free loopback port. It
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
  stop(): Promise<void>;
}

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

function send(response: ServerResponse, status: number, body = "", headers: Record<string, string> = {}): void {
  response.writeHead(status, { "content-length": String(Buffer.byteLength(body)), ...headers });
  response.end(body);
}

export async function startFakeS3(bucket = "backups"): Promise<FakeS3> {
  const objects = new Map<string, Buffer>();
  const uploads = new Map<string, Buffer[]>();
  const log: string[] = [];
  let nextUpload = 1;
  const state = { failPart: 0 };

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
      uploads.delete(uploadId);
      return send(response, 204);
    }
    if (request.method === "PUT") {
      objects.set(key, body);
      return send(response, 200, "", { etag: `"${etagOf(body)}"` });
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
      objects.delete(key);
      return send(response, 204);
    }
    if (found === undefined) return send(response, 404, "<Error><Code>NoSuchKey</Code></Error>");
    if (request.method === "HEAD") {
      response.writeHead(200, { "content-length": String(found.length), etag: `"${etagOf(found)}"` });
      response.end();
      return;
    }
    send(response, 200, found.toString("latin1"), { etag: `"${etagOf(found)}"` });
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
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
