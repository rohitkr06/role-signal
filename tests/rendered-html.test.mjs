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

test("keeps trustworthy evidence, discovery, and guarded execution contracts in source", async () => {
  const [worker, app, executionView, executionPolicy, studioView, documents, schema, extension, background, popup, manifest, scoring, vite, phase7Migration, phase8Migration, trustworthyMigration] = await Promise.all([
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/rolesignal-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/execution-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/application-execution.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/application-studio.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../browser-extension/content.js", import.meta.url), "utf8"),
    readFile(new URL("../browser-extension/background.js", import.meta.url), "utf8"),
    readFile(new URL("../browser-extension/popup.js", import.meta.url), "utf8"),
    readFile(new URL("../browser-extension/manifest.json", import.meta.url), "utf8"),
    readFile(new URL("../lib/rolesignal.ts", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0006_phase7_execution.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0007_phase8_unified_discovery.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0008_trustworthy_mvp.sql", import.meta.url), "utf8"),
  ]);
  assert.match(worker, /async scheduled/);
  assert.match(worker, /executeDueAutomations/);
  assert.match(worker, /\/api\/rolesignal\/automation\/settings/);
  assert.match(worker, /\/api\/rolesignal\/automation\/run-now/);
  assert.match(worker, /\/api\/rolesignal\/alerts\/read/);
  assert.match(worker, /\/api\/rolesignal\/jobs\/enrich/);
  assert.match(worker, /posting-api\/job-board/);
  assert.match(worker, /\/api\/rolesignal\/discovery\/run/);
  assert.match(worker, /\/api\/rolesignal\/discovery\/capture/);
  assert.match(worker, /\/api\/rolesignal\/discovery\/alerts/);
  assert.match(worker, /\/api\/rolesignal\/inbound-email/);
  assert.match(worker, /\/api\/rolesignal\/export\/discovery-run\.md/);
  assert.match(worker, /api\/v2\/remote-jobs/);
  assert.match(worker, /api\/job-board-api/);
  assert.match(worker, /api\.adzuna\.com\/v1\/api\/jobs\/in\/search/);
  assert.match(worker, /jooble\.org\/api/);
  assert.match(worker, /serpapi\.com\/search\.json/);
  assert.match(worker, /\/api\/rolesignal\/sources\/scan/);
  assert.match(worker, /\/api\/rolesignal\/sources\/scan-all/);
  assert.match(worker, /\/api\/rolesignal\/sources\/remove/);
  assert.match(worker, /\/api\/rolesignal\/answers/);
  assert.match(worker, /\/api\/rolesignal\/applications\/kit/);
  assert.match(worker, /\/api\/rolesignal\/studio\/generate/);
  assert.match(worker, /\/api\/rolesignal\/studio\/documents/);
  assert.match(worker, /\/api\/rolesignal\/studio\/approve/);
  assert.match(worker, /\/api\/rolesignal\/studio\/download/);
  assert.match(worker, /\/api\/rolesignal\/execution\/settings/);
  assert.match(worker, /\/api\/rolesignal\/execution\/queue-qualified/);
  assert.match(worker, /\/api\/rolesignal\/execution\/pair/);
  assert.match(worker, /\/api\/rolesignal\/companion\/claim/);
  assert.match(worker, /\/api\/rolesignal\/companion\/report/);
  assert.match(worker, /executionStatusFromReport/);
  assert.match(worker, /buildResumeDocx/);
  assert.match(worker, /buildResumePdf/);
  assert.match(worker, /\/api\/rolesignal\/export\/ledger\.csv/);
  assert.match(worker, /\/api\/rolesignal\/export\/run\.md/);
  assert.match(worker, /autoStaged/);
  assert.match(worker, /\/api\/rolesignal\/applications\/approve/);
  assert.match(worker, /\/api\/rolesignal\/profile\/confirm/);
  assert.match(worker, /assertCurrentEvidence/);
  assert.match(worker, /PENDING_REVIEW/);
  assert.match(worker, /source_health/);
  assert.match(worker, /neverSubmit:\s*true/);
  assert.match(schema, /applicationPackets/);
  assert.match(schema, /answerVault/);
  assert.match(schema, /searchRuns/);
  assert.match(schema, /applicationKits/);
  assert.match(schema, /discoverySearches/);
  assert.match(schema, /discoveryRuns/);
  assert.match(schema, /automationSettings/);
  assert.match(schema, /jobAlerts/);
  assert.match(schema, /alertImports/);
  assert.match(schema, /tailoredDocuments/);
  assert.match(schema, /idx_tailored_documents_user_job_version/);
  assert.match(schema, /idx_job_matches_user_fingerprint/);
  assert.match(schema, /applicationExecutions/);
  assert.match(schema, /companionDevices/);
  assert.match(schema, /executionSettings/);
  assert.match(schema, /careerProfileVersions/);
  assert.match(schema, /sourceHealth/);
  assert.match(schema, /activeProfileVersionId/);
  assert.match(schema, /profileVersionId/);
  assert.match(app, /extractText\(new Uint8Array/);
  assert.match(app, /extractRawText/);
  assert.match(app, /Verified answer vault/);
  assert.match(app, /One run\. Every connected source/);
  assert.match(app, /Review before activating/);
  assert.match(app, /Confirm profile first/);
  assert.match(app, /No live matches yet/);
  assert.match(app, /const displayJobs = liveJobs/);
  assert.match(app, /One search\. The best India-focused sources\./);
  assert.match(app, /Portal alert inbox/);
  assert.match(app, /Your job search keeps watch/);
  assert.match(app, /Signal inbox/);
  assert.match(app, /Deep-analyze JD/);
  assert.match(studioView, /Tailored application studio/i);
  assert.match(executionView, /Guarded browser fill/i);
  assert.match(executionView, /Move approved applications without losing control/);
  assert.match(executionView, /Auto-submit is not enabled/);
  assert.match(executionPolicy, /boards\\\.greenhouse/);
  assert.match(executionPolicy, /jobs\\\.lever/);
  assert.match(executionPolicy, /jobs\\\.ashbyhq/);
  assert.match(worker, /neverBypassCaptcha/);
  assert.match(studioView, /Tailored application studio/i);
  assert.match(studioView, /Approve & generate files/);
  assert.match(studioView, /Claim provenance/);
  assert.match(documents, /validateStudioContent/);
  assert.match(documents, /w:numPr/);
  assert.match(documents, /%PDF-1\.4/);
  assert.match(scoring, /semanticCatalog/);
  assert.match(scoring, /Message-driven systems/);
  assert.match(vite, /crons:\s*\["0 \* \* \* \*"\]/);
  assert.match(extension, /work_authorization/);
  assert.match(extension, /ROLE_SIGNAL_CAPTURE/);
  assert.match(extension, /captureVisibleJobs/);
  assert.match(extension, /neverSubmit/);
  assert.match(extension, /ROLE_SIGNAL_EXECUTE/);
  assert.match(extension, /hasCaptcha/);
  assert.match(extension, /requireSubmissionConfirmation|submissionConfirmed/);
  assert.match(background, /rolesignal-execution/);
  assert.match(background, /\/api\/rolesignal\/companion\/claim/);
  assert.match(background, /\/api\/rolesignal\/companion\/report/);
  assert.match(manifest, /"version": "0\.7\.0"/);
  assert.match(popup, /ROLE_SIGNAL_CAPTURE/);
  assert.match(popup, /ROLE_SIGNAL_RUN_NEXT/);
  assert.match(phase7Migration, /CREATE TABLE `application_executions`/);
  assert.match(phase8Migration, /CREATE TABLE `alert_imports`/);
  assert.match(trustworthyMigration, /CREATE TABLE `career_profile_versions`/);
  assert.match(trustworthyMigration, /CREATE TABLE `source_health`/);
  assert.match(trustworthyMigration, /SET `status` = 'STALE'/);
  assert.match(extension, /allowAutoSubmit/);
  assert.doesNotMatch(extension, /requestSubmit|\.submit\(/);
  assert.doesNotMatch(popup, /requestSubmit|\.submit\(/);
  assert.doesNotMatch(app, /sampleJobs|isSample/);
  assert.doesNotMatch(app, /Phase 8/);
  assert.doesNotMatch(executionView, /Auto-submit compatible/);
  assert.doesNotMatch(executionPolicy, /return \"AUTO_SUBMIT\"/);
  assert.doesNotMatch(worker, /SaaS Labs|JustCall|ROHIT_PROFILE/);
  assert.doesNotMatch(scoring, /SaaS Labs|JustCall|ROHIT_PROFILE/);
});
