/** RoleSignal Cloudflare Worker entry point. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  EMPTY_PROFILE,
  inferPlatform,
  inferWorkMode,
  profileFromResumeText,
  scoreJob,
  stripHtml,
  type CandidateProfile,
  type JobInput,
  type ScoredJob,
} from "../lib/rolesignal";
import { expandSearchKeywords } from "../lib/job-eligibility";
import { defaultDiscoveryKeywords, defaultDiscoveryName, isDiscoveryCandidate as isDiscoveryCandidateGeneric } from "../lib/discovery-query";
import {
  buildResumeDocx,
  buildResumePdf,
  buildStudioContent,
  validateStudioContent,
  type EvidenceBinding,
  type StudioContent,
  type StudioJob,
} from "../lib/application-studio";
import {
  clampExecutionSettings,
  effectiveExecutionMode,
  executionCapability,
  executionStatusFromReport,
  type ExecutionMode,
} from "../lib/application-execution";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  RESUMES: R2Bucket;
  ADZUNA_APP_ID?: string;
  ADZUNA_APP_KEY?: string;
  JOOBLE_API_KEY?: string;
  SERPAPI_API_KEY?: string;
  INBOUND_EMAIL_SECRET?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface RoleSignalScheduledController {
  scheduledTime: number;
  cron: string;
  noRetry(): void;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/rolesignal/")) {
      return handleRoleSignalApi(request, env, url, ctx);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
  async scheduled(_controller: RoleSignalScheduledController, env: Env) {
    await ensureSchema(env);
    await executeDueAutomations(env, new Date().toISOString());
  },
};

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    email TEXT,
    display_name TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS resumes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    object_key TEXT NOT NULL,
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    status TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    profile_version_id TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS preferences (
    user_id TEXT PRIMARY KEY,
    target_roles_json TEXT NOT NULL,
    locations_json TEXT NOT NULL,
    work_modes_json TEXT NOT NULL,
    match_threshold INTEGER NOT NULL,
    daily_limit INTEGER NOT NULL,
    auto_apply INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    company TEXT NOT NULL,
    role TEXT NOT NULL,
    location TEXT NOT NULL,
    work_mode TEXT NOT NULL,
    platform TEXT NOT NULL,
    application_url TEXT NOT NULL,
    match_score INTEGER NOT NULL,
    classification TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    discovered_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS applications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS career_profiles (
    user_id TEXT PRIMARY KEY,
    resume_id TEXT,
    active_profile_version_id TEXT,
    raw_text TEXT NOT NULL,
    extracted_json TEXT NOT NULL,
    status TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS career_profile_versions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    resume_id TEXT,
    version INTEGER NOT NULL,
    status TEXT NOT NULL,
    raw_text TEXT NOT NULL,
    extracted_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    activated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS job_sources (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    source_token TEXT NOT NULL,
    label TEXT NOT NULL,
    active INTEGER NOT NULL,
    last_scanned_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS job_matches (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    source_id TEXT,
    profile_version_id TEXT,
    resume_id TEXT,
    fingerprint TEXT NOT NULL,
    company TEXT NOT NULL,
    role TEXT NOT NULL,
    location TEXT NOT NULL,
    work_mode TEXT NOT NULL,
    platform TEXT NOT NULL,
    application_url TEXT NOT NULL,
    posted_date TEXT,
    description TEXT NOT NULL,
    compensation TEXT,
    match_score INTEGER NOT NULL,
    classification TEXT NOT NULL,
    status TEXT NOT NULL,
    score_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS application_packets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    profile_version_id TEXT,
    resume_id TEXT,
    status TEXT NOT NULL,
    answers_json TEXT NOT NULL,
    blockers_json TEXT NOT NULL,
    resume_strategy_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS application_events (
    id TEXT PRIMARY KEY,
    packet_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    detail_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS answer_vault (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    field_key TEXT NOT NULL,
    label TEXT NOT NULL,
    value TEXT NOT NULL,
    status TEXT NOT NULL,
    sensitive INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS search_runs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL,
    source_count INTEGER NOT NULL,
    jobs_discovered INTEGER NOT NULL,
    unique_jobs INTEGER NOT NULL,
    analyzed INTEGER NOT NULL,
    exceptional INTEGER NOT NULL,
    strong INTEGER NOT NULL,
    ready INTEGER NOT NULL,
    needs_input INTEGER NOT NULL,
    skipped INTEGER NOT NULL,
    report_json TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS application_kits (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    packet_id TEXT NOT NULL,
    profile_version_id TEXT,
    resume_id TEXT,
    summary TEXT NOT NULL,
    why_answer TEXT NOT NULL,
    resume_changes_json TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    form_answers_json TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS discovery_searches (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    keywords_json TEXT NOT NULL,
    locations_json TEXT NOT NULL,
    work_modes_json TEXT NOT NULL,
    portals_json TEXT NOT NULL,
    min_score INTEGER NOT NULL,
    active INTEGER NOT NULL,
    last_run_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS discovery_runs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    search_id TEXT,
    mode TEXT NOT NULL,
    status TEXT NOT NULL,
    providers_json TEXT NOT NULL,
    discovered INTEGER NOT NULL,
    imported INTEGER NOT NULL,
    duplicates INTEGER NOT NULL,
    qualified INTEGER NOT NULL,
    report_json TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS automation_settings (
    user_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL,
    cadence_hours INTEGER NOT NULL,
    min_score INTEGER NOT NULL,
    browser_alerts INTEGER NOT NULL,
    last_run_at TEXT,
    next_run_at TEXT NOT NULL,
    last_status TEXT NOT NULL,
    last_error TEXT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS job_alerts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    discovery_run_id TEXT,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    detail_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    read_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS alert_imports (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    message_key TEXT NOT NULL,
    subject TEXT NOT NULL,
    status TEXT NOT NULL,
    jobs_found INTEGER NOT NULL,
    imported INTEGER NOT NULL,
    duplicates INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS source_health (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    status TEXT NOT NULL,
    response_count INTEGER NOT NULL,
    accepted_count INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL,
    last_error TEXT,
    last_attempt_at TEXT NOT NULL,
    last_success_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS tailored_documents (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    resume_id TEXT,
    profile_version_id TEXT,
    version INTEGER NOT NULL,
    status TEXT NOT NULL,
    title TEXT NOT NULL,
    content_json TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    grounding_score INTEGER NOT NULL,
    docx_object_key TEXT,
    pdf_object_key TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    approved_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS execution_settings (
    user_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL,
    min_score INTEGER NOT NULL,
    daily_limit INTEGER NOT NULL,
    mode TEXT NOT NULL,
    require_tailored_resume INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS companion_devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    last_seen_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS application_executions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    packet_id TEXT NOT NULL,
    document_id TEXT,
    profile_version_id TEXT,
    resume_id TEXT,
    device_id TEXT,
    platform TEXT NOT NULL,
    mode TEXT NOT NULL,
    status TEXT NOT NULL,
    attempt_count INTEGER NOT NULL,
    fields_filled INTEGER NOT NULL,
    unknown_required_json TEXT NOT NULL,
    last_error TEXT,
    application_url TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    claimed_at TEXT,
    completed_at TEXT,
    submitted_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_resumes_user_id ON resumes(user_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_versions_user_version ON career_profile_versions(user_id, version)`,
  `CREATE INDEX IF NOT EXISTS idx_profile_versions_user_status ON career_profile_versions(user_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_match_score ON jobs(match_score DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_applications_user_status ON applications(user_id, status)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_job_sources_user_provider_token ON job_sources(user_id, provider, source_token)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_job_matches_user_fingerprint ON job_matches(user_id, fingerprint)`,
  `CREATE INDEX IF NOT EXISTS idx_job_matches_user_score ON job_matches(user_id, match_score DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_job_matches_user_status ON job_matches(user_id, status)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_application_packets_user_job ON application_packets(user_id, job_id)`,
  `CREATE INDEX IF NOT EXISTS idx_application_packets_user_status ON application_packets(user_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_application_events_packet ON application_events(packet_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_answer_vault_user_field ON answer_vault(user_id, field_key)`,
  `CREATE INDEX IF NOT EXISTS idx_search_runs_user_completed ON search_runs(user_id, completed_at DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_application_kits_user_job ON application_kits(user_id, job_id)`,
  `CREATE INDEX IF NOT EXISTS idx_application_kits_packet ON application_kits(packet_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_discovery_searches_user_name ON discovery_searches(user_id, name)`,
  `CREATE INDEX IF NOT EXISTS idx_discovery_searches_user_updated ON discovery_searches(user_id, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_discovery_runs_user_completed ON discovery_runs(user_id, completed_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_discovery_runs_search ON discovery_runs(search_id)`,
  `CREATE INDEX IF NOT EXISTS idx_automation_settings_due ON automation_settings(enabled, next_run_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_job_alerts_user_job_kind ON job_alerts(user_id, job_id, kind)`,
  `CREATE INDEX IF NOT EXISTS idx_job_alerts_user_status_created ON job_alerts(user_id, status, created_at DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_imports_user_message ON alert_imports(user_id, message_key)`,
  `CREATE INDEX IF NOT EXISTS idx_alert_imports_user_created ON alert_imports(user_id, created_at DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_source_health_user_provider ON source_health(user_id, provider)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_tailored_documents_user_job_version ON tailored_documents(user_id, job_id, version)`,
  `CREATE INDEX IF NOT EXISTS idx_tailored_documents_user_updated ON tailored_documents(user_id, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_tailored_documents_user_job_status ON tailored_documents(user_id, job_id, status)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_companion_devices_token_hash ON companion_devices(token_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_companion_devices_user_status ON companion_devices(user_id, status)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_application_executions_user_job ON application_executions(user_id, job_id)`,
  `CREATE INDEX IF NOT EXISTS idx_application_executions_user_status_updated ON application_executions(user_id, status, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_application_executions_device_status ON application_executions(device_id, status)`,
] as const;

async function ensureSchema(env: Env) {
  await env.DB.batch(schemaStatements.map((sql) => env.DB.prepare(sql)));
  const requiredColumns: Array<[string, string, string]> = [
    ["resumes", "version", "INTEGER NOT NULL DEFAULT 1"],
    ["resumes", "profile_version_id", "TEXT"],
    ["career_profiles", "active_profile_version_id", "TEXT"],
    ["job_matches", "profile_version_id", "TEXT"],
    ["job_matches", "resume_id", "TEXT"],
    ["application_packets", "profile_version_id", "TEXT"],
    ["application_packets", "resume_id", "TEXT"],
    ["application_kits", "profile_version_id", "TEXT"],
    ["application_kits", "resume_id", "TEXT"],
    ["tailored_documents", "profile_version_id", "TEXT"],
    ["application_executions", "profile_version_id", "TEXT"],
    ["application_executions", "resume_id", "TEXT"],
  ];
  for (const [table, column, definition] of requiredColumns) {
    const info = await env.DB.prepare(`PRAGMA table_info(${table})`).all<Record<string, unknown>>();
    if (!info.results.some((row) => row.name === column)) await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
  await env.DB.prepare("PRAGMA optimize").run();
}

function currentUser(request: Request) {
  const encodedName = request.headers.get("oai-authenticated-user-full-name");
  const encoding = request.headers.get("oai-authenticated-user-full-name-encoding");
  const email = request.headers.get("oai-authenticated-user-email") ?? "";
  let name = email ? email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "RoleSignal user";
  if (encodedName) {
    try { name = encoding === "percent-encoded-utf-8" ? decodeURIComponent(encodedName) : encodedName; } catch { name = encodedName; }
  }
  return {
    id: request.headers.get("oai-authenticated-user-id") ?? "local-preview-user",
    email,
    name,
  };
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function rowToJob(row: Record<string, unknown>) {
  const scored = parseJson<Record<string, unknown>>(row.score_json, {});
  return {
    ...scored,
    id: row.id,
    profileVersionId: row.profile_version_id,
    resumeId: row.resume_id,
    company: row.company,
    role: row.role,
    location: row.location,
    workMode: row.work_mode,
    platform: row.platform,
    applicationUrl: row.application_url,
    postedDate: row.posted_date,
    description: row.description,
    compensation: row.compensation,
    score: row.match_score,
    classification: row.classification,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

function rowToPacket(row: Record<string, unknown>) {
  const packet = {
    id: row.id,
    jobId: row.job_id,
    profileVersionId: row.profile_version_id,
    resumeId: row.resume_id,
    status: row.status,
    answers: parseJson(row.answers_json, {}),
    blockers: parseJson(row.blockers_json, []),
    resumeStrategy: parseJson(row.resume_strategy_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    company: row.company,
    role: row.role,
    applicationUrl: row.application_url,
    score: row.match_score,
  };
  if (!row.kit_id) return packet;
  return {
    ...packet,
    kit: {
      id: row.kit_id,
      summary: row.kit_summary,
      whyAnswer: row.kit_why_answer,
      resumeChanges: parseJson(row.kit_resume_changes_json, []),
      evidence: parseJson(row.kit_evidence_json, []),
      formAnswers: parseJson(row.kit_form_answers_json, {}),
      status: row.kit_status,
    },
  };
}

function rowToRun(row: Record<string, unknown>) {
  return {
    id: row.id,
    status: row.status,
    sourceCount: row.source_count,
    jobsDiscovered: row.jobs_discovered,
    uniqueJobs: row.unique_jobs,
    analyzed: row.analyzed,
    exceptional: row.exceptional,
    strong: row.strong,
    ready: row.ready,
    needsInput: row.needs_input,
    skipped: row.skipped,
    report: parseJson(row.report_json, {}),
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function rowToDiscoverySearch(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    keywords: parseJson(row.keywords_json, []),
    locations: parseJson(row.locations_json, []),
    workModes: parseJson(row.work_modes_json, []),
    portals: parseJson(row.portals_json, []),
    minScore: row.min_score,
    active: Boolean(row.active),
    lastRunAt: row.last_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToDiscoveryRun(row: Record<string, unknown>) {
  return {
    id: row.id,
    searchId: row.search_id,
    mode: row.mode,
    status: row.status,
    providers: parseJson(row.providers_json, []),
    discovered: row.discovered,
    imported: row.imported,
    duplicates: row.duplicates,
    qualified: row.qualified,
    report: parseJson(row.report_json, {}),
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function rowToAutomation(row?: Record<string, unknown> | null) {
  if (!row) return null;
  return {
    enabled: Boolean(row.enabled),
    cadenceHours: Number(row.cadence_hours),
    minScore: Number(row.min_score),
    browserAlerts: Boolean(row.browser_alerts),
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

function rowToAlert(row: Record<string, unknown>) {
  return {
    id: row.id,
    jobId: row.job_id,
    discoveryRunId: row.discovery_run_id,
    kind: row.kind,
    status: row.status,
    title: row.title,
    summary: row.summary,
    detail: parseJson(row.detail_json, {}),
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

function rowToAlertImport(row: Record<string, unknown>) {
  return {
    id: row.id,
    provider: row.provider,
    subject: row.subject,
    status: row.status,
    jobsFound: Number(row.jobs_found),
    imported: Number(row.imported),
    duplicates: Number(row.duplicates),
    createdAt: row.created_at,
  };
}

function rowToStudioDocument(row: Record<string, unknown>) {
  return {
    id: row.id,
    jobId: row.job_id,
    resumeId: row.resume_id,
    profileVersionId: row.profile_version_id,
    version: Number(row.version),
    status: row.status,
    title: row.title,
    content: parseJson<StudioContent | null>(row.content_json, null),
    evidence: parseJson<EvidenceBinding[]>(row.evidence_json, []),
    groundingScore: Number(row.grounding_score),
    hasDocx: Boolean(row.docx_object_key),
    hasPdf: Boolean(row.pdf_object_key),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedAt: row.approved_at,
    company: row.company,
    role: row.role,
    location: row.location,
    score: Number(row.match_score),
  };
}

function rowToExecutionSettings(row?: Record<string, unknown> | null) {
  return {
    enabled: Boolean(row?.enabled),
    minScore: Number(row?.min_score ?? 75),
    dailyLimit: Number(row?.daily_limit ?? 5),
    mode: "FILL_ONLY",
    requireTailoredResume: row ? Boolean(row.require_tailored_resume) : false,
    updatedAt: row?.updated_at ?? null,
  };
}

function rowToCompanionDevice(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
  };
}

function rowToExecution(row: Record<string, unknown>) {
  return {
    id: row.id,
    jobId: row.job_id,
    packetId: row.packet_id,
    documentId: row.document_id,
    profileVersionId: row.profile_version_id,
    resumeId: row.resume_id,
    deviceId: row.device_id,
    platform: row.platform,
    mode: row.mode,
    status: row.status,
    attemptCount: Number(row.attempt_count),
    fieldsFilled: Number(row.fields_filled),
    unknownRequired: parseJson(row.unknown_required_json, []),
    lastError: row.last_error,
    applicationUrl: row.application_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    claimedAt: row.claimed_at,
    completedAt: row.completed_at,
    submittedAt: row.submitted_at,
    company: row.company,
    role: row.role,
    location: row.location,
    score: Number(row.match_score),
    documentVersion: row.document_version ? Number(row.document_version) : null,
  };
}

function companionCors(origin = "*") {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-max-age": "86400",
    "cache-control": "no-store",
  };
}

function companionJson(data: unknown, status = 200) {
  return Response.json(data, { status, headers: companionCors() });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function newCompanionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const encoded = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `rs_live_${encoded}`;
}

async function companionDeviceForRequest(request: Request, env: Env) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token.startsWith("rs_live_")) return null;
  const hash = await sha256(token);
  return env.DB.prepare(
    "SELECT * FROM companion_devices WHERE token_hash = ? AND status = 'ACTIVE'",
  ).bind(hash).first<Record<string, unknown>>();
}

async function executionRows(env: Env, userId: string, profileVersionId: string) {
  const result = await env.DB.prepare(
    `SELECT e.*, j.company, j.role, j.location, j.match_score, d.version AS document_version
     FROM application_executions e
     JOIN job_matches j ON j.id = e.job_id
     LEFT JOIN tailored_documents d ON d.id = e.document_id
     WHERE e.user_id = ? AND e.profile_version_id = ? ORDER BY e.updated_at DESC LIMIT 100`,
  ).bind(userId, profileVersionId).all<Record<string, unknown>>();
  return result.results.map(rowToExecution);
}

function studioJobFromRow(row: Record<string, unknown>): StudioJob {
  return {
    id: asString(row.id),
    company: asString(row.company),
    role: asString(row.role),
    location: asString(row.location),
    description: asString(row.description),
    applicationUrl: asString(row.application_url),
    score: Number(row.match_score),
  };
}

function safeStudioContent(value: unknown): StudioContent {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const sections = Array.isArray(body.sections) ? body.sections.slice(0, 8).map((section, sectionIndex) => {
    const item = section && typeof section === "object" ? section as Record<string, unknown> : {};
    return {
      id: asString(item.id, `section-${sectionIndex + 1}`).replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 80),
      title: asString(item.title, "Section").slice(0, 120),
      items: Array.isArray(item.items) ? item.items.map((entry) => asString(entry).slice(0, 1_200)).filter(Boolean).slice(0, 30) : [],
    };
  }).filter((section) => section.items.length) : [];
  const answers = Array.isArray(body.answers) ? body.answers.slice(0, 10).map((answer, answerIndex) => {
    const item = answer && typeof answer === "object" ? answer as Record<string, unknown> : {};
    return {
      id: asString(item.id, `answer-${answerIndex + 1}`).replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 80),
      question: asString(item.question, "Application question").slice(0, 500),
      answer: asString(item.answer).slice(0, 2_000),
    };
  }).filter((answer) => answer.answer) : [];
  return {
    name: asString(body.name, "Candidate").slice(0, 120),
    headline: asString(body.headline, "Software Engineer").slice(0, 180),
    contactLine: asString(body.contactLine).slice(0, 500),
    summary: asString(body.summary).slice(0, 1_200),
    skills: Array.isArray(body.skills) ? body.skills.map((skill) => asString(skill).slice(0, 100)).filter(Boolean).slice(0, 30) : [],
    sections,
    coverNote: asString(body.coverNote).slice(0, 2_500),
    answers,
  };
}

async function studioSources(env: Env, user: { id: string; email: string; name: string }) {
  const row = await env.DB.prepare(
    `SELECT v.id AS profile_version_id, v.resume_id, v.raw_text, v.extracted_json
     FROM career_profiles p JOIN career_profile_versions v ON v.id = p.active_profile_version_id
     WHERE p.user_id = ? AND v.user_id = p.user_id AND v.status = 'ACTIVE'`,
  ).bind(user.id).first<Record<string, unknown>>();
  if (!row) throw new Error("Confirm your resume profile before creating tailored documents.");
  const rawText = asString(row?.raw_text).slice(0, 200_000);
  const profile = parseJson<CandidateProfile>(row?.extracted_json, EMPTY_PROFILE);
  const vault = await answersForUser(env, user.id);
  return { profileVersionId: asString(row?.profile_version_id), resumeId: asString(row?.resume_id), rawText, profile, vault: vault.values };
}

const answerDefinitions = {
  phone: { label: "Phone number", sensitive: true },
  linkedin_url: { label: "LinkedIn URL", sensitive: false },
  github_url: { label: "GitHub URL", sensitive: false },
  current_location: { label: "Current location", sensitive: false },
  notice_period: { label: "Notice period", sensitive: true },
  current_compensation: { label: "Current compensation", sensitive: true },
  expected_compensation: { label: "Expected compensation", sensitive: true },
  work_authorization: { label: "Work authorization", sensitive: true },
  relocation: { label: "Relocation preference", sensitive: true },
} as const;

type AnswerKey = keyof typeof answerDefinitions;

function answerKeyForQuestion(question: string): AnswerKey | "" {
  const text = question.toLowerCase();
  if (/phone|mobile/.test(text)) return "phone";
  if (/linkedin/.test(text)) return "linkedin_url";
  if (/github/.test(text)) return "github_url";
  if (/current location|where.*located/.test(text)) return "current_location";
  if (/notice period|joining time|available to start/.test(text)) return "notice_period";
  if (/current (compensation|salary|ctc)/.test(text)) return "current_compensation";
  if (/expected (compensation|salary|ctc)|salary expectation/.test(text)) return "expected_compensation";
  if (/authorization|visa|sponsor|legally authorized/.test(text)) return "work_authorization";
  if (/relocat/.test(text)) return "relocation";
  return "";
}

async function answersForUser(env: Env, userId: string) {
  const result = await env.DB.prepare(
    "SELECT field_key, label, value, status, sensitive, updated_at FROM answer_vault WHERE user_id = ? ORDER BY field_key",
  ).bind(userId).all<Record<string, unknown>>();
  const values: Record<string, string> = {};
  for (const row of result.results) values[asString(row.field_key)] = asString(row.value);
  return { rows: result.results, values };
}

function buildApplicationKit(
  profile: CandidateProfile,
  job: Record<string, unknown>,
  scored: ScoredJob,
  packetId: string,
  answers: Record<string, string>,
) {
  const evidence = (scored.matchingExperience ?? []).slice(0, 5);
  const resumeChanges = (scored.resumeChanges ?? []).slice(0, 5);
  const strongest = evidence.slice(0, 3).join(", ").replace(/, ([^,]*)$/, " and $1");
  const role = asString(job.role);
  const company = asString(job.company);
  const summary = `Use the active verified resume${scored.resumeFit === "CUSTOMIZE" ? " with targeted evidence ordering" : ""}. Lead with ${strongest || profile.title || "the most relevant verified experience"}.`;
  const whyAnswer = `This ${role} role aligns with my verified experience in ${strongest || profile.title || "software engineering"}. I am interested in applying that experience to ${company}'s product and engineering challenges.`;
  return {
    packetId,
    summary,
    whyAnswer,
    resumeChanges,
    evidence,
    formAnswers: answers,
    status: "READY_FOR_REVIEW",
  };
}

function selectHighestPriority(jobs: Array<Record<string, unknown>>, limit: number) {
  const sorted = [...jobs].sort((a, b) => {
    const aScore = Number(a.match_score) + (parseJson<{ highPriority?: boolean }>(a.score_json, {}).highPriority ? 4 : 0);
    const bScore = Number(b.match_score) + (parseJson<{ highPriority?: boolean }>(b.score_json, {}).highPriority ? 4 : 0);
    return bScore - aScore;
  });
  const selected: Array<Record<string, unknown>> = [];
  const companies = new Set<string>();
  for (const job of sorted) {
    const company = asString(job.company).toLowerCase();
    if (companies.has(company)) continue;
    selected.push(job);
    companies.add(company);
    if (selected.length === limit) break;
  }
  return selected;
}

function csvCell(value: unknown) {
  const text = String(value ?? "").replaceAll('"', '""');
  return `"${text}"`;
}

async function profileForUser(env: Env, user: { id: string; email: string; name: string }) {
  const row = await env.DB.prepare(
    `SELECT v.id AS profile_version_id, v.resume_id, v.extracted_json
     FROM career_profiles p
     JOIN career_profile_versions v ON v.id = p.active_profile_version_id AND v.user_id = p.user_id
     WHERE p.user_id = ? AND v.status = 'ACTIVE'`,
  ).bind(user.id).first<Record<string, unknown>>();
  if (!row?.extracted_json) return { ...EMPTY_PROFILE, name: "", email: user.email };
  const parsed = parseJson<CandidateProfile>(row.extracted_json, EMPTY_PROFILE);
  return {
    ...EMPTY_PROFILE,
    ...parsed,
    name: parsed.name,
    email: parsed.email || user.email,
    experienceYears: parsed.experienceYears || 0,
    skills: [...new Set(parsed.skills ?? [])],
    domains: [...new Set(parsed.domains ?? [])],
    evidence: [...new Set(parsed.evidence ?? [])].slice(0, 20),
  } satisfies CandidateProfile;
}

async function activeEvidenceForUser(env: Env, userId: string) {
  const row = await env.DB.prepare(
    `SELECT v.id AS profile_version_id, v.resume_id, v.version, v.extracted_json, v.activated_at
     FROM career_profiles p
     JOIN career_profile_versions v ON v.id = p.active_profile_version_id AND v.user_id = p.user_id
     WHERE p.user_id = ? AND v.status = 'ACTIVE'`,
  ).bind(userId).first<Record<string, unknown>>();
  if (!row) return null;
  return {
    profileVersionId: asString(row.profile_version_id),
    resumeId: asString(row.resume_id),
    version: Number(row.version),
    activatedAt: asString(row.activated_at),
    profile: parseJson<CandidateProfile>(row.extracted_json, EMPTY_PROFILE),
  };
}

async function requireActiveEvidence(env: Env, userId: string) {
  const active = await activeEvidenceForUser(env, userId);
  if (!active) throw new Error("Review and confirm your resume profile before discovering or applying to jobs.");
  return active;
}

async function pendingProfileForUser(env: Env, userId: string) {
  const row = await env.DB.prepare(
    `SELECT id, resume_id, version, status, extracted_json, created_at
     FROM career_profile_versions WHERE user_id = ? AND status = 'PENDING_REVIEW'
     ORDER BY version DESC LIMIT 1`,
  ).bind(userId).first<Record<string, unknown>>();
  if (!row) return null;
  return {
    id: row.id,
    resumeId: row.resume_id,
    version: Number(row.version),
    status: row.status,
    profile: parseJson<CandidateProfile>(row.extracted_json, EMPTY_PROFILE),
    createdAt: row.created_at,
  };
}

async function assertCurrentEvidence(env: Env, userId: string, profileVersionId: unknown) {
  const active = await requireActiveEvidence(env, userId);
  if (!profileVersionId || profileVersionId !== active.profileVersionId) {
    throw new Error("This item was created from an older resume. Rebuild it from your active verified profile.");
  }
  return active;
}

async function saveScoredJob(env: Env, userId: string, scored: ScoredJob, sourceId: string | null, now: string) {
  const active = await requireActiveEvidence(env, userId);
  const existing = await env.DB.prepare(
    "SELECT * FROM job_matches WHERE user_id = ? AND fingerprint = ?",
  ).bind(userId, scored.fingerprint).first<Record<string, unknown>>();
  const id = asString(existing?.id) || crypto.randomUUID();
  const officialPlatforms = new Set(["Company site", "Greenhouse", "Lever", "Ashby"]);
  if (existing && existing.profile_version_id === active.profileVersionId && officialPlatforms.has(asString(existing.platform)) && !officialPlatforms.has(scored.platform ?? "")) {
    return { id, duplicate: true, applicationUrl: asString(existing.application_url), preserved: true };
  }
  const shouldPreferNewUrl = !existing || officialPlatforms.has(scored.platform ?? "");
  const applicationUrl = shouldPreferNewUrl ? scored.applicationUrl : asString(existing.application_url, scored.applicationUrl);
  await env.DB.prepare(
    `INSERT INTO job_matches
     (id, user_id, source_id, profile_version_id, resume_id, fingerprint, company, role, location, work_mode, platform,
       application_url, posted_date, description, compensation, match_score, classification,
       status, score_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, fingerprint) DO UPDATE SET
       source_id = excluded.source_id,
       profile_version_id = excluded.profile_version_id,
       resume_id = excluded.resume_id,
       work_mode = excluded.work_mode,
       platform = excluded.platform,
       application_url = excluded.application_url,
       posted_date = excluded.posted_date,
       description = excluded.description,
       compensation = excluded.compensation,
       match_score = excluded.match_score,
       classification = excluded.classification,
       status = excluded.status,
       score_json = excluded.score_json,
       updated_at = excluded.updated_at`,
  ).bind(
    id, userId, sourceId, active.profileVersionId, active.resumeId || null, scored.fingerprint, scored.company, scored.role, scored.location,
    scored.workMode ?? "Not specified", scored.platform ?? "Company site", applicationUrl,
    scored.postedDate ?? null, scored.description, scored.compensation ?? null, scored.score,
    scored.classification, scored.status, JSON.stringify({ ...scored, applicationUrl }), now, now,
  ).run();
  return { id, duplicate: Boolean(existing), applicationUrl, preserved: false };
}

function isPrivateHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host.endsWith(".local") || host.endsWith(".internal")) return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const parts = ipv4.slice(1).map(Number);
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
}

async function safeFetch(urlValue: string, accept = "text/html,application/json") {
  let target: URL;
  try { target = new URL(urlValue); } catch { throw new Error("Enter a valid HTTPS job URL."); }
  if (target.protocol !== "https:" || isPrivateHostname(target.hostname)) throw new Error("Only public HTTPS job URLs are supported.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    let current = target;
    for (let redirect = 0; redirect <= 4; redirect += 1) {
      const response = await fetch(current, {
        headers: { accept, "user-agent": "RoleSignal/5.0 evidence-semantic job assistant" },
        redirect: "manual",
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirect === 4) throw new Error("The job source redirected too many times.");
        current = new URL(location, current);
        if (current.protocol !== "https:" || isPrivateHostname(current.hostname)) throw new Error("The job source redirected to an unsafe address.");
        continue;
      }
      if (!response.ok) throw new Error(`The job source returned ${response.status}.`);
      const length = Number(response.headers.get("content-length") ?? 0);
      if (length > 3_000_000) throw new Error("The job page is too large to import safely.");
      return response;
    }
    throw new Error("The job source could not be reached.");
  } finally {
    clearTimeout(timer);
  }
}

async function safeJsonFetch(urlValue: string, init: RequestInit = {}) {
  let target: URL;
  try { target = new URL(urlValue); } catch { throw new Error("The discovery provider URL is invalid."); }
  if (target.protocol !== "https:" || isPrivateHostname(target.hostname)) throw new Error("Only public HTTPS discovery providers are supported.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    headers.set("user-agent", "RoleSignal/8.0 unified job discovery");
    const response = await fetch(target, { ...init, headers, redirect: "error", signal: controller.signal });
    if (!response.ok) throw new Error(`The discovery provider returned ${response.status}.`);
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > 4_000_000) throw new Error("The discovery response is too large to process safely.");
    return response;
  } finally {
    clearTimeout(timer);
  }
}

function titleFromHtml(html: string) {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return stripHtml(og || title || "").split(/\s+[|–—]\s+/)[0].trim();
}

function metaContent(html: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return stripHtml(
    html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"))?.[1] ||
    html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escaped}["']`, "i"))?.[1] ||
    "",
  );
}

function findJobPosting(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findJobPosting(item);
      if (match) return match;
    }
    return null;
  }
  const object = value as Record<string, unknown>;
  const type = object["@type"];
  if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) return object;
  for (const child of Object.values(object)) {
    const match = findJobPosting(child);
    if (match) return match;
  }
  return null;
}

function jobPostingFromHtml(html: string) {
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const posting = findJobPosting(JSON.parse(match[1]));
      if (posting) return posting;
    } catch {
      // Continue to the next structured-data block.
    }
  }
  return null;
}

function structuredLocation(posting: Record<string, unknown> | null, fallback: string) {
  if (!posting) return fallback;
  if (asString(posting.jobLocationType).toUpperCase() === "TELECOMMUTE") return "Remote";
  const locations = Array.isArray(posting.jobLocation) ? posting.jobLocation : posting.jobLocation ? [posting.jobLocation] : [];
  const values = locations.map((location) => {
    if (!location || typeof location !== "object") return "";
    const addressValue = (location as Record<string, unknown>).address;
    if (typeof addressValue === "string") return addressValue;
    const address = addressValue && typeof addressValue === "object" ? addressValue as Record<string, unknown> : {};
    return [address.addressLocality, address.addressRegion, address.addressCountry].map((item) => asString(item)).filter(Boolean).join(", ");
  }).filter(Boolean);
  return values.join(" / ") || fallback;
}

async function enrichSavedJob(env: Env, user: { id: string; email: string; name: string }, jobId: string, now: string) {
  const row = await env.DB.prepare("SELECT * FROM job_matches WHERE id = ? AND user_id = ?").bind(jobId, user.id).first<Record<string, unknown>>();
  if (!row) throw new Error("That job is no longer available in your workspace.");
  const response = await safeFetch(asString(row.application_url), "text/html,application/xhtml+xml");
  const html = (await response.text()).slice(0, 3_000_000);
  const posting = jobPostingFromHtml(html);
  const structuredDescription = stripHtml(asString(posting?.description));
  const pageDescription = metaContent(html, "description") || metaContent(html, "og:description");
  const bodyDescription = stripHtml(html).slice(0, 120_000);
  const description = [structuredDescription, pageDescription, bodyDescription, asString(row.description)]
    .sort((a, b) => b.length - a.length)[0]
    .slice(0, 120_000);
  if (description.length < 120) throw new Error("The official page did not expose enough job-description text. Paste the full description during import instead.");
  const location = structuredLocation(posting, asString(row.location));
  const input: JobInput = {
    company: asString(row.company),
    role: asString(row.role),
    location,
    workMode: inferWorkMode(location, description),
    platform: asString(row.platform),
    applicationUrl: asString(row.application_url),
    postedDate: asString(posting?.datePosted, asString(row.posted_date)),
    description,
    compensation: asString(row.compensation),
  };
  const scored = scoreJob(await profileForUser(env, user), input);
  await env.DB.prepare(
    `UPDATE job_matches SET location = ?, work_mode = ?, posted_date = ?, description = ?,
     match_score = ?, classification = ?, status = ?, score_json = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
  ).bind(
    scored.location, scored.workMode, scored.postedDate || null, scored.description,
    scored.score, scored.classification, scored.status,
    JSON.stringify({ ...scored, enrichedAt: now, enrichmentSource: response.url || input.applicationUrl }),
    now, jobId, user.id,
  ).run();
  const updated = await env.DB.prepare("SELECT * FROM job_matches WHERE id = ? AND user_id = ?").bind(jobId, user.id).first<Record<string, unknown>>();
  return updated ? rowToJob(updated) : null;
}

function companyFromUrl(urlValue: string) {
  try {
    const host = new URL(urlValue).hostname.replace(/^www\./, "");
    const first = host.split(".")[0].replace(/[-_]/g, " ");
    return first.replace(/\b\w/g, (value) => value.toUpperCase());
  } catch { return "Unknown company"; }
}

async function importSingleJob(
  body: Record<string, unknown>,
  env: Env,
  user: { id: string; email: string; name: string },
  now: string,
) {
  const jobUrl = asString(body.jobUrl || body.applicationUrl);
  let description = asString(body.description);
  let role = asString(body.role);
  if (!jobUrl) throw new Error("An official application URL is required.");
  if (!description || !role) {
    const response = await safeFetch(jobUrl);
    const html = (await response.text()).slice(0, 500_000);
    description ||= stripHtml(html).slice(0, 120_000);
    role ||= titleFromHtml(html);
  }
  if (!description) throw new Error("Paste the full job description because this page blocks importing.");
  if (!role) throw new Error("Add the job title so RoleSignal can score the opportunity.");
  const company = asString(body.company, companyFromUrl(jobUrl));
  const location = asString(body.location, "Not specified");
  const input: JobInput = {
    company,
    role,
    location,
    workMode: asString(body.workMode, inferWorkMode(location, description)),
    platform: asString(body.platform, inferPlatform(jobUrl)),
    applicationUrl: jobUrl,
    postedDate: asString(body.postedDate),
    description: description.slice(0, 120_000),
    compensation: asString(body.compensation),
  };
  const scored = scoreJob(await profileForUser(env, user), input);
  const saved = await saveScoredJob(env, user.id, scored, null, now);
  return { ...scored, ...saved };
}

type GreenhouseJob = {
  id: number;
  title: string;
  updated_at?: string;
  absolute_url: string;
  content?: string;
  location?: { name?: string };
};

type LeverJob = {
  id: string;
  text: string;
  hostedUrl?: string;
  applyUrl?: string;
  createdAt?: number;
  description?: string;
  descriptionPlain?: string;
  additional?: string;
  additionalPlain?: string;
  categories?: { location?: string; commitment?: string; team?: string; allLocations?: string[] };
  lists?: Array<{ text?: string; content?: string }>;
};

type AshbyJob = {
  title?: string;
  location?: string;
  secondaryLocations?: Array<{ location?: string }>;
  isListed?: boolean;
  isRemote?: boolean;
  workplaceType?: "OnSite" | "Remote" | "Hybrid";
  descriptionHtml?: string;
  descriptionPlain?: string;
  publishedAt?: string;
  jobUrl?: string;
  applyUrl?: string;
  compensation?: {
    compensationTierSummary?: string;
    scrapeableCompensationSalarySummary?: string;
  };
};

async function scanSource(
  body: Record<string, unknown>,
  env: Env,
  user: { id: string; email: string; name: string },
  now: string,
) {
  const provider = asString(body.provider).toLowerCase();
  const token = asString(body.token);
  const label = asString(body.label, token.replace(/[-_]/g, " ").replace(/\b\w/g, (value) => value.toUpperCase()));
  if (!new Set(["greenhouse", "lever", "ashby"]).has(provider)) throw new Error("Choose Greenhouse, Lever or Ashby.");
  if (!/^[a-z0-9][a-z0-9_-]{1,79}$/i.test(token)) throw new Error("Enter the company board token from its careers URL.");

  const profile = await profileForUser(env, user);
  let inputs: JobInput[] = [];

  if (provider === "greenhouse") {
    const response = await safeFetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`, "application/json");
    const payload = await response.json() as { jobs?: GreenhouseJob[] };
    inputs = (payload.jobs ?? []).slice(0, 100).map((job) => {
      const description = stripHtml(job.content ?? "");
      const location = job.location?.name || "Not specified";
      return {
        externalId: String(job.id), company: label, role: job.title, location,
        workMode: inferWorkMode(location, description), platform: "Greenhouse",
        applicationUrl: job.absolute_url, postedDate: job.updated_at,
        description,
      };
    });
  } else if (provider === "lever") {
    const response = await safeFetch(`https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json&limit=100`, "application/json");
    const payload = await response.json() as LeverJob[];
    inputs = payload.slice(0, 100).map((job) => {
      const description = stripHtml([
        job.descriptionPlain || job.description || "",
        ...(job.lists ?? []).map((item) => `${item.text ?? ""} ${stripHtml(item.content ?? "")}`),
        job.additionalPlain || job.additional || "",
      ].join(" "));
      const location = job.categories?.allLocations?.join(", ") || job.categories?.location || "Not specified";
      return {
        externalId: job.id, company: label, role: job.text, location,
        workMode: inferWorkMode(location, description), platform: "Lever",
        applicationUrl: job.hostedUrl || job.applyUrl || `https://jobs.lever.co/${token}/${job.id}`,
        postedDate: job.createdAt ? new Date(job.createdAt).toISOString() : undefined,
        description,
      };
    });
  } else {
    const response = await safeFetch(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}?includeCompensation=true`, "application/json");
    const payload = await response.json() as { jobs?: AshbyJob[] };
    inputs = (payload.jobs ?? []).filter((job) => job.isListed !== false).slice(0, 100).map((job) => {
      const description = stripHtml(job.descriptionPlain || job.descriptionHtml || "");
      const location = [job.location, ...(job.secondaryLocations ?? []).map((item) => item.location)].filter(Boolean).join(" / ") || "Not specified";
      const workMode = job.workplaceType === "OnSite" ? "On-site" : job.workplaceType || (job.isRemote ? "Remote" : inferWorkMode(location, description));
      return {
        externalId: job.jobUrl || job.applyUrl, company: label, role: asString(job.title, "Untitled role"), location,
        workMode, platform: "Ashby", applicationUrl: job.jobUrl || job.applyUrl || `https://jobs.ashbyhq.com/${encodeURIComponent(token)}`,
        postedDate: job.publishedAt, description,
        compensation: job.compensation?.scrapeableCompensationSalarySummary || job.compensation?.compensationTierSummary,
      };
    });
  }

  const sourceId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO job_sources (id, user_id, provider, source_token, label, active, last_scanned_at, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(user_id, provider, source_token) DO UPDATE SET
       label = excluded.label, active = 1, last_scanned_at = excluded.last_scanned_at`,
  ).bind(sourceId, user.id, provider, token, label, now, now).run();
  const sourceRow = await env.DB.prepare(
    "SELECT id FROM job_sources WHERE user_id = ? AND provider = ? AND source_token = ?",
  ).bind(user.id, provider, token).first<Record<string, unknown>>();
  const durableSourceId = asString(sourceRow?.id, sourceId);
  let duplicates = 0;
  const scored: Array<ScoredJob & { id: string }> = [];
  for (const input of inputs) {
    const result = scoreJob(profile, input);
    const saved = await saveScoredJob(env, user.id, result, durableSourceId, now);
    if (saved.duplicate) duplicates += 1;
    scored.push({ ...result, id: saved.id });
  }
  return {
    provider,
    source: label,
    discovered: inputs.length,
    unique: inputs.length - duplicates,
    duplicates,
    strong: scored.filter((job) => job.score >= 82).length,
    ready: scored.filter((job) => job.score >= 75 && job.status !== "SKIPPED").length,
    skipped: scored.filter((job) => job.status === "SKIPPED").length,
    top: scored.sort((a, b) => b.score - a.score).slice(0, 10),
  };
}
