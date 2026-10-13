/**
 * src/core/mask-secrets.ts: the display-only masking of the output tail that
 * `vigil show` and the web vigil page print. Every value below is a made-up
 * placeholder.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { MASK, maskSecrets } from "../src/core/mask-secrets.ts";

test("Authorization headers and Bearer tokens are masked, the scheme word stays", () => {
  assert.equal(maskSecrets("Authorization: Bearer abc123def456ghi789"), `Authorization: Bearer ${MASK}`);
  assert.equal(maskSecrets("> authorization: Basic dXNlcjpwYXNzd29yZA=="), `> authorization: Basic ${MASK}`);
  assert.equal(maskSecrets("Proxy-Authorization: placeholder-value-1"), `Proxy-Authorization: ${MASK}`);
  assert.equal(maskSecrets('curl -H "Authorization: token 0123456789abcdef"'), `curl -H "Authorization: token ${MASK}"`);
  assert.equal(maskSecrets("sent bearer eyJhbGciOiJIUzI1NiJ9.e30.sig1 to the api"), `sent bearer ${MASK} to the api`);
});

test("values after key=, token=, password= and other secret names are masked", () => {
  assert.equal(maskSecrets("GET /v1?key=abc&page=2"), `GET /v1?key=${MASK}&page=2`);
  assert.equal(maskSecrets("token=placeholder"), `token=${MASK}`);
  assert.equal(maskSecrets("DB_PASSWORD='hunter2' psql"), `DB_PASSWORD='${MASK}' psql`);
  assert.equal(maskSecrets("export GITHUB_TOKEN=xyz"), `export GITHUB_TOKEN=${MASK}`);
  assert.equal(maskSecrets("x-api-key = value9"), `x-api-key = ${MASK}`);
  assert.equal(maskSecrets('{"client_secret": "abcd1234efgh"}'), `{"client_secret": "${MASK}"}`);
  assert.equal(maskSecrets("password: hunter2hunter2"), `password: ${MASK}`);
});

test("well-known key shapes are masked wherever they stand; the prefix stays", () => {
  assert.equal(maskSecrets("using sk-or-v1-0123456789abcdef0123 now"), `using sk-${MASK} now`);
  assert.equal(maskSecrets("sk-ant-api03-placeholderplaceholder"), `sk-${MASK}`);
  assert.equal(maskSecrets("cloned with ghp_0123456789abcdefABCDEF0123"), `cloned with ghp_${MASK}`);
  assert.equal(maskSecrets("github_pat_11AAAAAAA0123456789_abcdef"), `github_pat_${MASK}`);
  assert.equal(maskSecrets("aws id AKIAIOSFODNN7EXAMPLE"), `aws id AKIA${MASK}`);
  assert.equal(maskSecrets("slack xoxb-0123456789-abcdefghij"), `slack xoxb-${MASK}`);
});

test("a long hex or base64 run shortly after a secret-like word is masked", () => {
  assert.equal(maskSecrets("the secret is 3f2a9c1d4e5b6a7f8091a2b3c4d5e6f7"), `the secret is ${MASK}`);
  assert.equal(maskSecrets("auth header was: dGVzdDpwbGFjZWhvbGRlcjEyMzQ1Ng=="), `auth header was: ${MASK}`);
});

test("ordinary output is left alone", () => {
  const plain = [
    "error: connection refused",
    "Expected exit 0, got 1",
    "monkey=3 max_tokens=100 keys=4",
    "token: expired",
    "the password is wrong",
    "Bearer authentication failed",
    "commit 3f2a9c1d4e5b6a7f8091a2b3c4d5e6f708192a3b",
    "sk-learn is installed; task-runner ok",
    "key points: none",
    "secret file /etc/ssl/private/server2026.pem",
    "<script>alert(1)</script>",
    "",
  ];
  for (const line of plain) assert.equal(maskSecrets(line), line, line);
  assert.equal(maskSecrets(plain.join("\n")), plain.join("\n"), "lines stay lines");
});

test("masking is stable: masking twice changes nothing more", () => {
  const once = maskSecrets("token=abc Authorization: Bearer abc123def456 sk-0123456789abcdef0123");
  assert.equal(maskSecrets(once), once);
});
