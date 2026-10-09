/**
 * The one way the page writes to darius: a JSON POST to a same-origin path
 * (the server checks the Origin header, so nothing here sets one). The
 * answer is `{ ok: true, ... }` or `{ ok: false, error }`; a network error and
 * an answer that is not JSON both come back as `ok: false` with a plain
 * sentence, so a caller never needs a try block. The body can hold a secret
 * (the key pair), so nothing here logs it or puts it in an error text.
 */

export interface PostOk {
  ok: true;
  status: number;
  /** `started` of a run request. */
  started: boolean;
  /** `count` of a bucket check; null when the answer has none. */
  count: number | null;
  /** `run` of a follow-up start (0.69.0): the new run; null when the answer has none. */
  run: string | null;
  /** `host` of a follow-up start: where the run started. */
  host: string | null;
  /** `message` of an answer that is ok but not done yet, such as a follow-up still starting. */
  message: string | null;
  /** `runNow.error` of an acknowledgement (0.80.0): the answer is saved, the run did not start. Null when the answer has none. */
  runNowError: string | null;
  /** `resumed` of an answer to a held run (0.80.0): the run went on. */
  resumed: boolean;
  /** `resume.error` of an answer to a held run: the answers are saved, the resume was refused. Null when the answer has none. */
  resumeError: string | null;
}

export interface PostFailed {
  ok: false;
  /** The HTTP status; 0 when the request never got an answer. */
  status: number;
  error: string;
}

export type PostResult = PostOk | PostFailed;

/** What the endpoints take as a body: JSON values only. */
export type PostBody = {
  readonly [key: string]:
    | string
    | number
    | boolean
    | null
    | readonly number[]
    | readonly string[]
    | { readonly [key: string]: string | number | boolean | null }
    | readonly { readonly [key: string]: string | number | boolean | null }[];
};

type Scalar = string | number | boolean | null;

function failed(status: number, error: string): PostFailed {
  return { ok: false, status, error };
}

/** Read an answer: the endpoints send one JSON object, anything else is a failure. */
function parse(status: number, text: string): PostResult {
  let reply: Map<string, Scalar | { readonly [key: string]: Scalar }>;
  try {
    reply = new Map(Object.entries(Object(JSON.parse(text))));
  } catch {
    return failed(status, `The host answered ${status} with text that is not JSON.`);
  }
  const error = reply.get("error");
  if (reply.get("ok") !== true) return failed(status, error === undefined || error === null || error === "" ? `The host answered ${status}.` : String(error));
  const count = reply.get("count");
  const textOf = (key: string): string | null => {
    const value = reply.get(key);
    return value === undefined || value === null || value === "" ? null : String(value);
  };
  const nestedError: Scalar | undefined = new Map<string, Scalar>(Object.entries(Object(reply.get("runNow")))).get("error");
  const resumeError: Scalar | undefined = new Map<string, Scalar>(Object.entries(Object(reply.get("resume")))).get("error");
  return {
    ok: true,
    status,
    started: reply.get("started") === true,
    count: count === undefined || count === null || !Number.isInteger(count) ? null : Number(count),
    run: textOf("run"),
    host: textOf("host"),
    message: textOf("message"),
    resumed: reply.get("resumed") === true,
    resumeError: resumeError === undefined || resumeError === null || resumeError === "" ? null : String(resumeError),
    runNowError: nestedError === undefined || nestedError === null || nestedError === "" ? null : String(nestedError),
  };
}

/** POST `body` as JSON to `path` on this origin. */
export async function postJson(path: string, body: PostBody): Promise<PostResult> {
  let response: Response;
  try {
    response = await fetch(path, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
  } catch {
    return failed(0, "The host did not answer. Check the connection and try again.");
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    return failed(response.status, `The host answered ${response.status}, but the answer could not be read.`);
  }
  return parse(response.status, text);
}
