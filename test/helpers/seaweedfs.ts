/**
 * A real SeaweedFS for tests: one rootless podman container on a free
 * loopback port, removed again in `stop()`.
 *
 * Ported from an earlier S3 test helper, minus the AWS SDK. The S3 client is never mocked; tests talk to the real server.
 *
 * Rules this helper keeps (plan-tonight.md, "Safety rules"):
 * - The port is published on 127.0.0.1 only. `-ip=0.0.0.0` below is the bind
 *   address INSIDE the container's own network namespace, which podman's port
 *   forward needs; nothing on the host listens on 0.0.0.0.
 * - Never 9900 (another SeaweedFS on the lead host) or 9910 (darius on the lead host).
 * - The image is the digest-pinned one the other SeaweedFS uses, run with `--pull=never`, so
 *   a test never reaches the network.
 * - The config dir holds throwaway credentials and a throwaway SSE key, and is
 *   deleted in `stop()`.
 */

import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { createS3, S3Error, S3NetworkError, type Credentials, type RemoteConfig, type S3 } from "../../src/core/s3.ts";

const execFileAsync = promisify(execFile);

export const SEAWEEDFS_IMAGE =
  "docker.io/chrislusf/seaweedfs@sha256:f898c91e42d7da5f4bb13f1efd424ff03ba85b420312eb929708a384e8a8b03d";
const S3_CONTAINER_PORT = 8333;
const RESERVED_PORTS: ReadonlySet<number> = new Set([9900, 9910]);
const PORT_ATTEMPTS = 20;
const READY_ATTEMPTS = 60;
const READY_DELAY_MS = 500;

/** Throwaway test identity. Not a secret, never used against a real endpoint. */
export const TEST_CREDENTIALS: Credentials = {
  accessKeyId: "darius-test-access",
  secretAccessKey: "darius-test-secret-throwaway",
};

export interface SeaweedFs {
  containerName: string;
  endpoint: string;
  /** Ready for `createS3`. The bucket already exists. */
  remote: RemoteConfig;
  credentials: Credentials;
  s3: S3;
  stop(): Promise<void>;
}

export interface StartOptions {
  bucket?: string;
  /** Configure the SSE key-encryption key. Without it SeaweedFS answers 500 to any SSE put. Default true. */
  sseKek?: boolean;
}

/**
 * Why the real-S3 tests cannot run here, or null when they can.
 * Callers skip loudly with this text; it is an inconclusive environment
 * (probe contract exit 3), not a failure.
 */
export async function seaweedfsUnavailable(): Promise<string | null> {
  try {
    await execFileAsync("podman", ["--version"]);
  } catch {
    return "podman is not installed (inconclusive environment, exit 3)";
  }
  try {
    await execFileAsync("podman", ["image", "exists", SEAWEEDFS_IMAGE]);
  } catch {
    return `image ${SEAWEEDFS_IMAGE} is not pulled; run: podman pull ${SEAWEEDFS_IMAGE} (inconclusive environment, exit 3)`;
  }
  return null;
}

/** A TCP listener reports an AddressInfo; only a pipe server reports a string. */
export function isAddressInfo(address: string | AddressInfo | null): address is AddressInfo {
  return address !== null && typeof address !== "string";
}

async function freeLoopbackPort(): Promise<number> {
  for (let attempt = 1; attempt <= PORT_ATTEMPTS; attempt += 1) {
    const port = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const found = isAddressInfo(address) ? address.port : 0;
        server.close(() => resolve(found));
      });
    });
    if (port !== 0 && !RESERVED_PORTS.has(port)) return port;
  }
  throw new Error(`no free loopback port after ${PORT_ATTEMPTS} attempts`);
}

async function writeConfigDir(sseKek: boolean): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "darius-seaweedfs-test-"));
  // Rootless podman does not remap ownership on a bind mount, so the
  // container's root (a subordinate host uid) cannot traverse a 0700 dir.
  await chmod(dir, 0o755);
  const identity = {
    identities: [
      {
        name: "darius-test",
        credentials: [{ accessKey: TEST_CREDENTIALS.accessKeyId, secretKey: TEST_CREDENTIALS.secretAccessKey }],
        actions: ["Admin", "Read", "Write", "List", "Tagging"],
      },
    ],
  };
  await writeFile(join(dir, "identity.json"), JSON.stringify(identity), { mode: 0o644 });
  if (sseKek) {
    const kek = randomBytes(32).toString("base64");
    await writeFile(join(dir, "security.toml"), `[s3.sse]\nkey = "${kek}"\n`, { mode: 0o644 });
  }
  return dir;
}

async function removeContainer(name: string): Promise<void> {
  await execFileAsync("podman", ["rm", "--force", "--time", "0", name]).catch(() => undefined);
}

/** Retry `ensureBucket` until the gateway answers: /status can go green before the filer serves. */
async function createBucketWhenReady(s3: S3, endpoint: string): Promise<void> {
  let lastError = "no attempt made";
  for (let attempt = 1; attempt <= READY_ATTEMPTS; attempt += 1) {
    try {
      await s3.ensureBucket();
      return;
    } catch (error) {
      const isTransient = error instanceof S3NetworkError || (error instanceof S3Error && error.status >= 500);
      if (!isTransient) throw error;
      lastError = error.message;
    }
    await delay(READY_DELAY_MS);
  }
  throw new Error(`SeaweedFS at ${endpoint} not ready after ${READY_ATTEMPTS} attempts: ${lastError}`);
}

export async function startSeaweedFs(options: StartOptions = {}): Promise<SeaweedFs> {
  const bucket = options.bucket ?? "darius-test";
  const port = await freeLoopbackPort();
  const containerName = `darius-s3-test-${randomUUID()}`;
  const endpoint = `http://127.0.0.1:${port}`;
  const configDir = await writeConfigDir(options.sseKek ?? true);

  async function stop(): Promise<void> {
    await removeContainer(containerName);
    await rm(configDir, { recursive: true, force: true });
  }

  try {
    await execFileAsync("podman", [
      "run",
      "--rm",
      "--detach",
      "--pull=never",
      "--label=darius-test=s3",
      "--name",
      containerName,
      "--publish",
      `127.0.0.1:${port}:${S3_CONTAINER_PORT}`,
      "--volume",
      `${configDir}:/etc/sw:ro,Z`,
      SEAWEEDFS_IMAGE,
      // A global weed flag: it must come before `server`, or SeaweedFS
      // ignores it and loads neither the identity nor the SSE key.
      "-config_dir=/etc/sw",
      "server",
      "-s3",
      "-s3.config=/etc/sw/identity.json",
      "-dir=/data",
      "-ip=0.0.0.0",
    ]);
    const remote: RemoteConfig = {
      endpoint,
      bucket,
      region: "us-east-1",
      path_style: true,
      allow_http: true,
      // Always on, as in production. Without the KEK a put then fails with
      // 500, which is exactly what a test of that case wants to see.
      sse: true,
      credentials: "(test helper, in memory)",
    };
    const s3 = createS3(remote, TEST_CREDENTIALS);
    await createBucketWhenReady(s3, endpoint);
    return { containerName, endpoint, remote, credentials: TEST_CREDENTIALS, s3, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
