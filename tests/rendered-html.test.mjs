import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the RoleSignal product shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>RoleSignal/);
  assert.match(html, /Find work worth applying for/);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton/);
});

test("keeps Phase 3 operations, safety, and persistence contracts in source", async () => {
  const [worker, app, schema, extension] = await Promise.all([
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/rolesignal-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../browser-extension/content.js", import.meta.url), "utf8"),
  ]);
  assert.match(worker, /\/api\/rolesignal\/sources\/scan/);
  assert.match(worker, /\/api\/rolesignal\/sources\/scan-all/);
  assert.match(worker, /\/api\/rolesignal\/sources\/remove/);
  assert.match(worker, /\/api\/rolesignal\/answers/);
  assert.match(worker, /\/api\/rolesignal\/applications\/kit/);
  assert.match(worker, /\/api\/rolesignal\/export\/ledger\.csv/);
  assert.match(worker, /\/api\/rolesignal\/export\/run\.md/);
  assert.match(worker, /autoStaged/);
  assert.match(worker, /\/api\/rolesignal\/applications\/approve/);
  assert.match(worker, /neverSubmit:\s*true/);
  assert.match(schema, /applicationPackets/);
  assert.match(schema, /answerVault/);
  assert.match(schema, /searchRuns/);
  assert.match(schema, /applicationKits/);
  assert.match(schema, /idx_job_matches_user_fingerprint/);
  assert.match(app, /extractText\(new Uint8Array/);
  assert.match(app, /extractRawText/);
  assert.match(app, /Verified answer vault/);
  assert.match(app, /One run\. Every connected source/);
  assert.match(extension, /work_authorization/);
  assert.match(extension, /neverSubmit/);
  assert.doesNotMatch(extension, /\.click\(\)|requestSubmit|\.submit\(/);
});
