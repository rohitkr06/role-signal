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

async function scanAllSources(
  env: Env,
  user: { id: string; email: string; name: string },
  startedAt: string,
) {
  const sourceResult = await env.DB.prepare(
    "SELECT provider, source_token, label FROM job_sources WHERE user_id = ? AND active = 1 ORDER BY created_at",
  ).bind(user.id).all<Record<string, unknown>>();
  if (!sourceResult.results.length) throw new Error("Connect at least one Greenhouse or Lever board before running a full scan.");

  const runId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO search_runs
     (id, user_id, status, source_count, jobs_discovered, unique_jobs, analyzed,
      exceptional, strong, ready, needs_input, skipped, report_json, started_at, completed_at)
     VALUES (?, ?, 'RUNNING', ?, 0, 0, 0, 0, 0, 0, 0, 0, '{}', ?, NULL)`,
  ).bind(runId, user.id, sourceResult.results.length, startedAt).run();

  const sourceReports: Array<Record<string, unknown>> = [];
  const failures: Array<{ source: string; message: string }> = [];
  for (const source of sourceResult.results) {
    try {
      sourceReports.push(await scanSource({
        provider: source.provider,
        token: source.source_token,
        label: source.label,
      }, env, user, new Date().toISOString()));
    } catch (error) {
      failures.push({
        source: asString(source.label, asString(source.source_token)),
        message: error instanceof Error ? error.message : "Source scan failed",
      });
    }
  }

  const [jobsResult, preferences] = await Promise.all([
    env.DB.prepare(
      "SELECT * FROM job_matches WHERE user_id = ? AND updated_at >= ? ORDER BY match_score DESC, updated_at DESC LIMIT 200",
    ).bind(user.id, startedAt).all<Record<string, unknown>>(),
    env.DB.prepare(
      "SELECT auto_apply, daily_limit, match_threshold FROM preferences WHERE user_id = ?",
    ).bind(user.id).first<Record<string, unknown>>(),
  ]);
  const jobs = jobsResult.results;
  const discovered = sourceReports.reduce((sum, report) => sum + Number(report.discovered ?? 0), 0);
  const uniqueJobs = sourceReports.reduce((sum, report) => sum + Number(report.unique ?? 0), 0);
  const exceptional = jobs.filter((job) => Number(job.match_score) >= 90).length;
  const strong = jobs.filter((job) => Number(job.match_score) >= 82 && Number(job.match_score) < 90).length;
  const ready = jobs.filter((job) => Number(job.match_score) >= 75 && job.status !== "SKIPPED").length;
  const skipped = jobs.filter((job) => job.status === "SKIPPED").length;
  const topRows = jobs.slice(0, 10);
  const priorityRows = selectHighestPriority(jobs.filter((job) => Number(job.match_score) >= 75 && job.status !== "SKIPPED"), 3);
  const autoStaged: Array<{ packetId: string; jobId: string; status: string }> = [];
  const autoStageFailures: Array<{ jobId: string; message: string }> = [];
  if (Number(preferences?.auto_apply ?? 0) === 1) {
    const threshold = Math.max(75, Number(preferences?.match_threshold ?? 75));
    const limit = Math.max(1, Math.min(20, Number(preferences?.daily_limit ?? 5)));
    const candidates = jobs
      .filter((job) => Number(job.match_score) >= threshold && job.status !== "SKIPPED")
      .sort((a, b) => Number(b.match_score) - Number(a.match_score))
      .slice(0, limit);
    for (const candidate of candidates) {
      try {
        const packet = await prepareApplication({ jobId: candidate.id }, env, user, new Date().toISOString());
        autoStaged.push({ packetId: packet.id, jobId: asString(candidate.id), status: packet.status });
      } catch (error) {
        autoStageFailures.push({
          jobId: asString(candidate.id),
          message: error instanceof Error ? error.message : "Application staging failed",
        });
      }
    }
  }
  const needsInputRow = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM application_packets WHERE user_id = ? AND status = 'NEEDS_INPUT'",
  ).bind(user.id).first<Record<string, unknown>>();
  const report = {
    sourceReports,
    failures,
    topOpportunities: topRows.map(rowToJob),
    highestPriority: priorityRows.map(rowToJob),
    autoStaged,
    autoStageFailures,
  };
  const completedAt = new Date().toISOString();
  const status = failures.length === sourceResult.results.length ? "FAILED" : failures.length ? "PARTIAL" : "COMPLETED";
  await env.DB.prepare(
    `UPDATE search_runs SET
       status = ?, jobs_discovered = ?, unique_jobs = ?, analyzed = ?, exceptional = ?,
       strong = ?, ready = ?, needs_input = ?, skipped = ?, report_json = ?, completed_at = ?
     WHERE id = ? AND user_id = ?`,
  ).bind(
    status, discovered, uniqueJobs, jobs.length, exceptional, strong, ready,
    Number(needsInputRow?.count ?? 0), skipped, JSON.stringify(report), completedAt, runId, user.id,
  ).run();
  return {
    id: runId,
    status,
    sourceCount: sourceResult.results.length,
    jobsDiscovered: discovered,
    uniqueJobs,
    analyzed: jobs.length,
    exceptional,
    strong,
    ready,
    needsInput: Number(needsInputRow?.count ?? 0),
    skipped,
    report,
    startedAt,
    completedAt,
  };
}

type DiscoveryConfig = {
  name: string;
  keywords: string[];
  locations: string[];
  workModes: string[];
  portals: string[];
  minScore: number;
};

type JobicyJob = {
  id?: number | string;
  url?: string;
  jobTitle?: string;
  companyName?: string;
  jobIndustry?: string[] | string;
  jobType?: string[] | string;
  jobGeo?: string;
  jobLevel?: string;
  jobExcerpt?: string;
  jobDescription?: string;
  pubDate?: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  salaryPeriod?: string;
};

type ArbeitnowJob = {
  slug?: string;
  company_name?: string;
  title?: string;
  description?: string;
  remote?: boolean;
  url?: string;
  tags?: string[];
  job_types?: string[];
  location?: string;
  created_at?: number;
};

type AdzunaJob = {
  id?: string;
  title?: string;
  description?: string;
  redirect_url?: string;
  created?: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  salary_min?: number;
  salary_max?: number;
};

type JoobleJob = {
  id?: string | number;
  title?: string;
  company?: string;
  location?: string;
  snippet?: string;
  salary?: string;
  source?: string;
  type?: string;
  link?: string;
  updated?: string;
};

type GoogleJob = {
  title?: string;
  company_name?: string;
  location?: string;
  description?: string;
  share_link?: string;
  via?: string;
  detected_extensions?: { posted_at?: string; schedule_type?: string; work_from_home?: boolean };
  apply_options?: Array<{ title?: string; link?: string }>;
};

type DiscoveryProviderResult = {
  provider: string;
  discovered: number;
  candidates: JobInput[];
};

type DiscoverySourceStatus = {
  id: string;
  name: string;
  lane: "PUBLIC_API" | "COMPANY_ATS" | "PORTAL_ALERTS" | "OPTIONAL_INDEX";
  status: "LIVE" | "CONNECTED" | "READY" | "NEEDS_KEY" | "NEVER_TESTED" | "DEGRADED" | "UNAVAILABLE";
  coverage: string;
  note: string;
  responseCount?: number;
  acceptedCount?: number;
  latencyMs?: number;
  lastAttemptAt?: string | null;
  lastSuccessAt?: string | null;
  lastError?: string | null;
};

function stringList(value: unknown, fallback: string[]) {
  const source = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : fallback;
  return [...new Set(source.map((item) => asString(item).slice(0, 80)).filter(Boolean))].slice(0, 12);
}

function discoveryConfig(body: Record<string, unknown>): DiscoveryConfig {
  return {
    name: asString(body.name, "Backend roles / India + Remote").slice(0, 80),
    keywords: stringList(body.keywords, ["Backend Engineer", "Software Engineer", "Platform Engineer", "Node.js"]),
    locations: stringList(body.locations, ["India", "Remote", "APAC"]),
    workModes: stringList(body.workModes, ["Remote", "Hybrid"]),
    portals: stringList(body.portals, ["Jobicy", "Arbeitnow", "Connected ATS boards"]),
    minScore: Math.max(65, Math.min(95, Number(body.minScore ?? 75))),
  };
}

function isDiscoveryCandidate(job: JobInput, config: DiscoveryConfig) {
  const role = job.role.toLowerCase();
  const description = job.description.toLowerCase();
  const targetTerms = config.keywords.flatMap((keyword) => {
    const normalized = keyword.toLowerCase().trim();
    const tokens = normalized.split(/[^a-z0-9+#.]+/).filter((token) => token.length >= 3 && !new Set(["engineer", "engineering", "software", "developer"]).has(token));
    return [normalized, ...tokens];
  });
  const roleRelevant = targetTerms.some((term) => role.includes(term)) || /backend|back-end|platform engineer|api engineer|infrastructure engineer|distributed systems|node\.js|nodejs/.test(role);
  if (!roleRelevant) return false;
  const mode = (job.workMode || inferWorkMode(job.location, description)).toLowerCase();
  const location = job.location.toLowerCase();
  const locationRelevant = config.locations.some((wanted) => {
    const value = wanted.toLowerCase();
    if (value === "remote") return mode === "remote" || /worldwide|anywhere/.test(location);
    if (value === "apac") return /apac|asia|india|singapore|australia|remote|worldwide|anywhere/.test(location);
    return location.includes(value);
  });
  return locationRelevant || (config.workModes.some((value) => value.toLowerCase() === "remote") && mode === "remote");
}

function compensationFromJobicy(job: JobicyJob) {
  if (job.salaryMin == null && job.salaryMax == null) return "";
  const range = [job.salaryMin, job.salaryMax].filter((value) => value != null).join("-");
  return [job.salaryCurrency, range, job.salaryPeriod].filter(Boolean).join(" ");
}

async function upsertDiscoverySearch(env: Env, userId: string, config: DiscoveryConfig, now: string) {
  const generatedId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO discovery_searches
     (id, user_id, name, keywords_json, locations_json, work_modes_json, portals_json,
      min_score, active, last_run_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)
     ON CONFLICT(user_id, name) DO UPDATE SET
       keywords_json = excluded.keywords_json,
       locations_json = excluded.locations_json,
       work_modes_json = excluded.work_modes_json,
       portals_json = excluded.portals_json,
       min_score = excluded.min_score,
       active = 1,
       updated_at = excluded.updated_at`,
  ).bind(
    generatedId, userId, config.name, JSON.stringify(config.keywords), JSON.stringify(config.locations),
    JSON.stringify(config.workModes), JSON.stringify(config.portals), config.minScore, now, now,
  ).run();
  return env.DB.prepare(
    "SELECT * FROM discovery_searches WHERE user_id = ? AND name = ?",
  ).bind(userId, config.name).first<Record<string, unknown>>();
}

async function autoStageJobs(
  rows: Array<Record<string, unknown>>,
  env: Env,
  user: { id: string; email: string; name: string },
  threshold: number,
) {
  const preferences = await env.DB.prepare(
    "SELECT auto_apply, daily_limit, match_threshold FROM preferences WHERE user_id = ?",
  ).bind(user.id).first<Record<string, unknown>>();
  if (Number(preferences?.auto_apply ?? 0) !== 1) return [];
  const effectiveThreshold = Math.max(75, threshold, Number(preferences?.match_threshold ?? 75));
  const limit = Math.max(1, Math.min(20, Number(preferences?.daily_limit ?? 5)));
  const staged: Array<{ packetId: string; jobId: string; status: string }> = [];
  for (const row of rows.filter((job) => Number(job.match_score) >= effectiveThreshold && job.status !== "SKIPPED").slice(0, limit)) {
    try {
      const packet = await prepareApplication({ jobId: row.id }, env, user, new Date().toISOString());
      staged.push({ packetId: asString(packet.id), jobId: asString(row.id), status: asString(packet.status) });
    } catch {
      // A single application packet must never abort the discovery run.
    }
  }
  return staged;
}

async function createJobAlerts(
  env: Env,
  userId: string,
  runId: string,
  rows: Array<Record<string, unknown>>,
  threshold: number,
  now: string,
) {
  const candidates = rows
    .filter((row) => Number(row.match_score) >= threshold && row.status !== "SKIPPED")
    .sort((a, b) => Number(b.match_score) - Number(a.match_score))
    .slice(0, 12);
  if (!candidates.length) return 0;
  const results = await env.DB.batch(candidates.map((row) => {
    const job = rowToJob(row) as Record<string, unknown>;
    const evidence = Array.isArray(job.matchingExperience) ? job.matchingExperience.slice(0, 2).join(" ") : "Strong verified backend evidence overlap.";
    const alertJob = {
      id: job.id, company: job.company, role: job.role, location: job.location,
      workMode: job.workMode, platform: job.platform, applicationUrl: job.applicationUrl,
      score: job.score, classification: job.classification, status: job.status,
      matchingExperience: Array.isArray(job.matchingExperience) ? job.matchingExperience.slice(0, 3) : [],
      semanticMatches: Array.isArray(job.semanticMatches) ? job.semanticMatches.slice(0, 3) : [],
    };
    return env.DB.prepare(
      `INSERT INTO job_alerts
       (id, user_id, job_id, discovery_run_id, kind, status, title, summary, detail_json, created_at, read_at)
       VALUES (?, ?, ?, ?, 'NEW_MATCH', 'UNREAD', ?, ?, ?, ?, NULL)
       ON CONFLICT(user_id, job_id, kind) DO NOTHING`,
    ).bind(
      crypto.randomUUID(), userId, row.id, runId,
      `${row.company}: ${row.role}`,
      `${row.match_score}/100 ${row.classification} match. ${evidence}`.slice(0, 600),
      JSON.stringify({ job: alertJob, score: row.match_score, classification: row.classification }),
      now,
    );
  }));
  return results.reduce((total, result) => total + Number(result.meta?.changes ?? 0), 0);
}

function discoverySources(env: Env, connectedBoards: number, healthRows: Record<string, unknown>[] = []): DiscoverySourceStatus[] {
  const health = new Map(healthRows.map((row) => [asString(row.provider), row]));
  const automatic = (id: string, name: string, coverage: string, configured = true, needsKey = "") => {
    const row = health.get(name);
    if (!configured) return { id, name, lane: "PUBLIC_API" as const, status: "NEEDS_KEY" as const, coverage, note: needsKey };
    if (!row) return { id, name, lane: "PUBLIC_API" as const, status: "NEVER_TESTED" as const, coverage, note: "Run discovery to verify this source" };
    return {
      id, name, lane: "PUBLIC_API" as const, status: asString(row.status) as DiscoverySourceStatus["status"], coverage,
      note: row.last_error ? asString(row.last_error) : `${Number(row.response_count)} received / ${Number(row.accepted_count)} relevant`,
      responseCount: Number(row.response_count), acceptedCount: Number(row.accepted_count), latencyMs: Number(row.latency_ms),
      lastAttemptAt: asString(row.last_attempt_at) || null, lastSuccessAt: asString(row.last_success_at) || null, lastError: asString(row.last_error) || null,
    };
  };
  return [
    automatic("jobicy", "Jobicy", "Remote / APAC"),
    automatic("arbeitnow", "Arbeitnow", "Aggregated company jobs"),
    automatic("adzuna", "Adzuna India", "India-wide listings", Boolean(env.ADZUNA_APP_ID && env.ADZUNA_APP_KEY), "Add ADZUNA_APP_ID and ADZUNA_APP_KEY"),
    automatic("jooble", "Jooble", "India + wider web", Boolean(env.JOOBLE_API_KEY), "Add JOOBLE_API_KEY"),
    { id: "company-ats", name: "Official company boards", lane: "COMPANY_ATS", status: connectedBoards ? "CONNECTED" : "READY", coverage: `${connectedBoards} Greenhouse / Lever / Ashby board${connectedBoards === 1 ? "" : "s"}`, note: connectedBoards ? "Scanned with every run" : "Add target employers when useful" },
    { id: "portal-alerts", name: "Portal alert inbox", lane: "PORTAL_ALERTS", status: "READY", coverage: "LinkedIn, Naukri, Indeed, Foundit", note: "Imports alerts without signing into portals" },
    { ...automatic("google-jobs", "Google Jobs", "Broad India web index", Boolean(env.SERPAPI_API_KEY), "Optional SERPAPI_API_KEY"), lane: "OPTIONAL_INDEX" },
  ];
}

async function recordSourceHealth(env: Env, userId: string, provider: string, status: "LIVE" | "DEGRADED" | "UNAVAILABLE", responseCount: number, acceptedCount: number, latencyMs: number, error: string | null, now: string) {
  await env.DB.prepare(
    `INSERT INTO source_health (id, user_id, provider, status, response_count, accepted_count, latency_ms, last_error, last_attempt_at, last_success_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, provider) DO UPDATE SET status = excluded.status, response_count = excluded.response_count,
       accepted_count = excluded.accepted_count, latency_ms = excluded.latency_ms, last_error = excluded.last_error,
       last_attempt_at = excluded.last_attempt_at, last_success_at = COALESCE(excluded.last_success_at, source_health.last_success_at)`,
  ).bind(crypto.randomUUID(), userId, provider, status, responseCount, acceptedCount, latencyMs, error, now, status === "LIVE" ? now : null).run();
}

function primaryDiscoveryQuery(config: DiscoveryConfig) {
  return config.keywords.slice(0, 4).join(" OR ") || "software engineer";
}

async function fetchJobicyDiscovery(config: DiscoveryConfig): Promise<DiscoveryProviderResult> {
  const keyword = config.keywords[0]?.replace(/\b(engineer|engineering|developer)\b/gi, "").trim() || "backend";
  const url = new URL("https://jobicy.com/api/v2/remote-jobs");
  url.searchParams.set("count", "100");
  url.searchParams.set("geo", "apac");
  url.searchParams.set("industry", "engineering");
  url.searchParams.set("tag", keyword);
  const payload = await safeJsonFetch(url.toString()).then((response) => response.json() as Promise<{ jobs?: JobicyJob[] }>);
  const jobs = payload.jobs ?? [];
  const candidates = jobs.map((job): JobInput => ({
    externalId: String(job.id ?? job.url ?? ""), company: asString(job.companyName, "Unknown company"),
    role: asString(job.jobTitle, "Untitled role"), location: asString(job.jobGeo, "Remote"), workMode: "Remote",
    platform: "Jobicy", applicationUrl: asString(job.url), postedDate: asString(job.pubDate),
    description: stripHtml(asString(job.jobDescription, asString(job.jobExcerpt))), compensation: compensationFromJobicy(job),
  })).filter((job) => job.applicationUrl && isDiscoveryCandidate(job, config));
  return { provider: "Jobicy", discovered: jobs.length, candidates };
}

async function fetchArbeitnowDiscovery(config: DiscoveryConfig): Promise<DiscoveryProviderResult> {
  const payload = await safeJsonFetch("https://www.arbeitnow.com/api/job-board-api?page=1").then((response) => response.json() as Promise<{ data?: ArbeitnowJob[] }>);
  const jobs = payload.data ?? [];
  const candidates = jobs.map((job): JobInput => ({
    externalId: asString(job.slug, asString(job.url)), company: asString(job.company_name, "Unknown company"),
    role: asString(job.title, "Untitled role"), location: asString(job.location, job.remote ? "Remote" : "Not specified"),
    workMode: job.remote ? "Remote" : inferWorkMode(asString(job.location), asString(job.description)), platform: "Arbeitnow",
    applicationUrl: asString(job.url), postedDate: job.created_at ? new Date(job.created_at * 1000).toISOString() : "",
    description: stripHtml(asString(job.description)),
  })).filter((job) => job.applicationUrl && isDiscoveryCandidate(job, config));
  return { provider: "Arbeitnow", discovered: jobs.length, candidates };
}

async function fetchAdzunaDiscovery(config: DiscoveryConfig, env: Env): Promise<DiscoveryProviderResult> {
  if (!env.ADZUNA_APP_ID || !env.ADZUNA_APP_KEY) throw new Error("Adzuna is not connected.");
  const url = new URL("https://api.adzuna.com/v1/api/jobs/in/search/1");
  url.searchParams.set("app_id", env.ADZUNA_APP_ID);
  url.searchParams.set("app_key", env.ADZUNA_APP_KEY);
  url.searchParams.set("results_per_page", "50");
  url.searchParams.set("what", primaryDiscoveryQuery(config));
  url.searchParams.set("sort_by", "date");
  url.searchParams.set("max_days_old", "30");
  url.searchParams.set("content-type", "application/json");
  const payload = await safeJsonFetch(url.toString()).then((response) => response.json() as Promise<{ results?: AdzunaJob[] }>);
  const jobs = payload.results ?? [];
  const candidates = jobs.map((job): JobInput => {
    const location = asString(job.location?.display_name, "India");
    const description = stripHtml(asString(job.description));
    const salary = job.salary_min == null && job.salary_max == null ? "" : `INR ${[job.salary_min, job.salary_max].filter((value) => value != null).join("-")}`;
    return {
      externalId: asString(job.id, asString(job.redirect_url)), company: asString(job.company?.display_name, "Unknown company"),
      role: asString(job.title, "Untitled role"), location, workMode: inferWorkMode(location, description), platform: "Adzuna India",
      applicationUrl: asString(job.redirect_url), postedDate: asString(job.created), description, compensation: salary,
    };
  }).filter((job) => job.applicationUrl && isDiscoveryCandidate(job, config));
  return { provider: "Adzuna India", discovered: jobs.length, candidates };
}

async function fetchJoobleDiscovery(config: DiscoveryConfig, env: Env): Promise<DiscoveryProviderResult> {
  if (!env.JOOBLE_API_KEY) throw new Error("Jooble is not connected.");
  const payload = await safeJsonFetch(`https://jooble.org/api/${encodeURIComponent(env.JOOBLE_API_KEY)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ keywords: primaryDiscoveryQuery(config), location: "India", page: "1", ResultOnPage: "50" }),
  }).then((response) => response.json() as Promise<{ jobs?: JoobleJob[] }>);
  const jobs = payload.jobs ?? [];
  const candidates = jobs.map((job): JobInput => {
    const location = asString(job.location, "India");
    const description = stripHtml(asString(job.snippet));
    return {
      externalId: String(job.id ?? job.link ?? ""), company: asString(job.company, "Unknown company"), role: asString(job.title, "Untitled role"),
      location, workMode: inferWorkMode(location, `${description} ${asString(job.type)}`), platform: "Jooble",
      applicationUrl: asString(job.link), postedDate: asString(job.updated), description, compensation: asString(job.salary),
    };
  }).filter((job) => job.applicationUrl && isDiscoveryCandidate(job, config));
  return { provider: "Jooble", discovered: jobs.length, candidates };
}

async function fetchGoogleJobsDiscovery(config: DiscoveryConfig, env: Env): Promise<DiscoveryProviderResult> {
  if (!env.SERPAPI_API_KEY) throw new Error("Google Jobs index is not connected.");
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_jobs");
  url.searchParams.set("q", `${primaryDiscoveryQuery(config)} jobs`);
  url.searchParams.set("location", "India");
  url.searchParams.set("gl", "in");
  url.searchParams.set("hl", "en");
  url.searchParams.set("api_key", env.SERPAPI_API_KEY);
  const payload = await safeJsonFetch(url.toString()).then((response) => response.json() as Promise<{ jobs_results?: GoogleJob[] }>);
  const jobs = payload.jobs_results ?? [];
  const candidates = jobs.map((job, index): JobInput => {
    const location = asString(job.location, "India");
    const description = stripHtml(asString(job.description));
    const applicationUrl = asString(job.apply_options?.find((option) => option.link)?.link, asString(job.share_link));
    return {
      externalId: applicationUrl || `${job.company_name}-${job.title}-${index}`, company: asString(job.company_name, "Unknown company"),
      role: asString(job.title, "Untitled role"), location,
      workMode: job.detected_extensions?.work_from_home ? "Remote" : inferWorkMode(location, `${description} ${asString(job.detected_extensions?.schedule_type)}`),
      platform: "Google Jobs", applicationUrl, postedDate: asString(job.detected_extensions?.posted_at), description,
    };
  }).filter((job) => job.applicationUrl && isDiscoveryCandidate(job, config));
  return { provider: "Google Jobs", discovered: jobs.length, candidates };
}

async function runDiscovery(
  body: Record<string, unknown>,
  env: Env,
  user: { id: string; email: string; name: string },
  startedAt: string,
) {
  await requireActiveEvidence(env, user.id);
  const config = discoveryConfig(body);
  const mode = body.mode === "SCHEDULED" ? "SCHEDULED" : "PUBLIC_FEEDS";
  const force = body.force === true || mode === "SCHEDULED";
  const searchRow = await upsertDiscoverySearch(env, user.id, config, startedAt);
  const searchId = asString(searchRow?.id);
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recent = await env.DB.prepare(
    "SELECT * FROM discovery_runs WHERE user_id = ? AND search_id = ? AND mode = 'PUBLIC_FEEDS' AND completed_at >= ? ORDER BY completed_at DESC LIMIT 1",
  ).bind(user.id, searchId, oneHourAgo).first<Record<string, unknown>>();
  if (!force && recent) return { ...rowToDiscoveryRun(recent), cached: true };

  const runId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO discovery_runs
     (id, user_id, search_id, mode, status, providers_json, discovered, imported,
      duplicates, qualified, report_json, started_at, completed_at)
     VALUES (?, ?, ?, ?, 'RUNNING', '[]', 0, 0, 0, 0, '{}', ?, NULL)`,
  ).bind(runId, user.id, searchId, mode, startedAt).run();

  const providerReports: Array<{ provider: string; discovered: number; relevant: number; imported: number; duplicates: number }> = [];
  const failures: Array<{ provider: string; message: string }> = [];
  const candidates: JobInput[] = [];
  const connectors: Array<{ provider: string; run: () => Promise<DiscoveryProviderResult> }> = [
    { provider: "Jobicy", run: () => fetchJobicyDiscovery(config) },
    { provider: "Arbeitnow", run: () => fetchArbeitnowDiscovery(config) },
  ];
  if (env.ADZUNA_APP_ID && env.ADZUNA_APP_KEY) connectors.push({ provider: "Adzuna India", run: () => fetchAdzunaDiscovery(config, env) });
  if (env.JOOBLE_API_KEY) connectors.push({ provider: "Jooble", run: () => fetchJoobleDiscovery(config, env) });
  if (env.SERPAPI_API_KEY) connectors.push({ provider: "Google Jobs", run: () => fetchGoogleJobsDiscovery(config, env) });

  const connectorStartedAt = connectors.map(() => Date.now());
  const feedResults = await Promise.allSettled(connectors.map((connector) => connector.run()));
  for (let index = 0; index < connectors.length; index += 1) {
    const connector = connectors[index];
    const result = feedResults[index];
    if (result.status === "fulfilled") {
      await recordSourceHealth(env, user.id, connector.provider, "LIVE", result.value.discovered, result.value.candidates.length, Date.now() - connectorStartedAt[index], null, new Date().toISOString());
      candidates.push(...result.value.candidates);
      providerReports.push({
        provider: result.value.provider,
        discovered: result.value.discovered,
        relevant: result.value.candidates.length,
        imported: 0,
        duplicates: 0,
      });
    } else {
      const message = result.reason instanceof Error ? result.reason.message : "Feed unavailable";
      await recordSourceHealth(env, user.id, connector.provider, "UNAVAILABLE", 0, 0, Date.now() - connectorStartedAt[index], message, new Date().toISOString());
      failures.push({ provider: connector.provider, message });
    }
  }

  const sourceResult = await env.DB.prepare(
    "SELECT provider, source_token, label FROM job_sources WHERE user_id = ? AND active = 1 ORDER BY created_at",
  ).bind(user.id).all<Record<string, unknown>>();
  for (const source of sourceResult.results) {
    try {
      const report = await scanSource({ provider: source.provider, token: source.source_token, label: source.label }, env, user, new Date().toISOString());
      providerReports.push({ provider: `${asString(source.label)} / ${asString(source.provider)}`, discovered: report.discovered, relevant: report.discovered, imported: report.unique, duplicates: report.duplicates });
    } catch (error) {
      failures.push({ provider: `${asString(source.label)} / ${asString(source.provider)}`, message: error instanceof Error ? error.message : "Board scan failed" });
    }
  }

  const profile = await profileForUser(env, user);
  let duplicates = providerReports.reduce((sum, report) => sum + report.duplicates, 0);
  const runRows: Array<Record<string, unknown>> = [];
  for (const candidate of candidates.slice(0, 180)) {
    const scored = scoreJob(profile, candidate);
    const savedAt = new Date().toISOString();
    const saved = await saveScoredJob(env, user.id, scored, null, savedAt);
    if (saved.duplicate) duplicates += 1;
    const provider = providerReports.find((report) => report.provider === candidate.platform);
    if (provider) {
      provider.imported += saved.duplicate ? 0 : 1;
      provider.duplicates += saved.duplicate ? 1 : 0;
    }
    if (saved.preserved) {
      const preserved = await env.DB.prepare("SELECT * FROM job_matches WHERE id = ? AND user_id = ?").bind(saved.id, user.id).first<Record<string, unknown>>();
      if (preserved) runRows.push(preserved);
      continue;
    }
    runRows.push({
      id: saved.id, user_id: user.id, source_id: null, fingerprint: scored.fingerprint,
      company: scored.company, role: scored.role, location: scored.location,
      work_mode: scored.workMode ?? "Not specified", platform: scored.platform ?? "Company site",
      application_url: saved.applicationUrl, posted_date: scored.postedDate ?? null,
      description: scored.description, compensation: scored.compensation ?? null,
      match_score: scored.score, classification: scored.classification, status: scored.status,
      score_json: JSON.stringify({ ...scored, applicationUrl: saved.applicationUrl }), updated_at: savedAt,
    });
  }

  const touchedRows = await env.DB.prepare(
    "SELECT * FROM job_matches WHERE user_id = ? AND updated_at >= ? ORDER BY match_score DESC LIMIT 300",
  ).bind(user.id, startedAt).all<Record<string, unknown>>();
  const includedIds = new Set(runRows.map((row) => asString(row.id)));
  for (const row of touchedRows.results) {
    const id = asString(row.id);
    if (!includedIds.has(id)) {
      runRows.push(row);
      includedIds.add(id);
    }
  }

  runRows.sort((a, b) => Number(b.match_score) - Number(a.match_score));
  const qualified = runRows.filter((row) => Number(row.match_score) >= config.minScore && row.status !== "SKIPPED");
  const autoStaged = await autoStageJobs(runRows, env, user, config.minScore);
  const topRows = runRows.slice(0, 10);
  const report = {
    config,
    providerReports,
    failures,
    topOpportunities: topRows.map(rowToJob),
    highestPriority: selectHighestPriority(qualified, 3).map(rowToJob),
    autoStaged,
    alertsCreated: 0,
  };
  const completedAt = new Date().toISOString();
  const status = failures.length === providerReports.length + failures.length ? "FAILED" : failures.length ? "PARTIAL" : "COMPLETED";
  const discovered = providerReports.reduce((sum, report) => sum + report.discovered, 0);
  const imported = providerReports.reduce((sum, report) => sum + report.imported, 0);
  const alertsCreated = await createJobAlerts(env, user.id, runId, qualified, config.minScore, completedAt);
  report.alertsCreated = alertsCreated;
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE discovery_runs SET status = ?, providers_json = ?, discovered = ?, imported = ?,
       duplicates = ?, qualified = ?, report_json = ?, completed_at = ? WHERE id = ? AND user_id = ?`,
    ).bind(status, JSON.stringify(providerReports), discovered, imported, duplicates, qualified.length, JSON.stringify(report), completedAt, runId, user.id),
    env.DB.prepare("UPDATE discovery_searches SET last_run_at = ?, updated_at = ? WHERE id = ? AND user_id = ?")
      .bind(completedAt, completedAt, searchId, user.id),
  ]);
  return rowToDiscoveryRun({
    id: runId, user_id: user.id, search_id: searchId, mode, status,
    providers_json: JSON.stringify(providerReports), discovered, imported, duplicates,
    qualified: qualified.length, report_json: JSON.stringify(report), started_at: startedAt, completed_at: completedAt,
  });
}

function decodeAlertText(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function looksLikeJobLink(value: string) {
  try {
    const url = new URL(decodeAlertText(value));
    if (url.protocol !== "https:" || isPrivateHostname(url.hostname)) return false;
    const text = `${url.hostname}${url.pathname}`.toLowerCase();
    if (/unsubscribe|preferences|notification-settings|privacy|help|support|login|signup/.test(text)) return false;
    return /job|career|position|opening|posting|apply|view/.test(text);
  } catch {
    return false;
  }
}

function alertJobFromRecord(value: Record<string, unknown>, provider: string): JobInput | null {
  const applicationUrl = decodeAlertText(asString(value.applicationUrl || value.url || value.link));
  const role = asString(value.role || value.title).slice(0, 180);
  if (!role || !looksLikeJobLink(applicationUrl)) return null;
  const location = asString(value.location, "India").slice(0, 160);
  const description = stripHtml(asString(value.description || value.snippet || value.cardText, `${role}. Imported from a ${provider} job alert.`)).slice(0, 20_000);
  return {
    externalId: asString(value.externalId, applicationUrl),
    company: asString(value.company, `${provider} listing`).slice(0, 120),
    role,
    location,
    workMode: asString(value.workMode, inferWorkMode(location, description)),
    platform: provider,
    applicationUrl,
    postedDate: asString(value.postedDate || value.updated),
    description,
    compensation: asString(value.compensation || value.salary),
  };
}

function extractJobsFromAlert(body: Record<string, unknown>, provider: string) {
  const structured = Array.isArray(body.jobs)
    ? body.jobs.slice(0, 100).map((value) => alertJobFromRecord(value as Record<string, unknown>, provider)).filter((value): value is JobInput => Boolean(value))
    : [];
  if (structured.length) return structured;

  const content = asString(body.content || body.html || body.text).slice(0, 500_000);
  if (!content) return [];
  const candidates: JobInput[] = [];
  const seen = new Set<string>();
  const addCandidate = (rawUrl: string, rawTitle: string, context: string) => {
    const applicationUrl = decodeAlertText(rawUrl).replace(/[)>.,]+$/, "");
    if (!looksLikeJobLink(applicationUrl) || seen.has(applicationUrl)) return;
    const plainContext = stripHtml(decodeAlertText(context)).replace(/\s+/g, " ").trim();
    let role = stripHtml(decodeAlertText(rawTitle)).replace(/\s+/g, " ").trim();
    if (!role || /^(view|open|apply|see|learn|details|view job|apply now)$/i.test(role)) {
      const contextLines = stripHtml(decodeAlertText(context)).split(/\r?\n|\s{2,}/).map((line) => line.trim()).filter(Boolean);
      for (let index = contextLines.length - 1; index >= 0; index -= 1) {
        if (contextLines[index].length >= 5 && contextLines[index].length <= 180 && !/unsubscribe|alert|notification|view job/i.test(contextLines[index])) {
          role = contextLines[index];
          break;
        }
      }
    }
    if (!role || role.length > 180) return;
    const roleAtCompany = role.match(/^(.+?)\s+at\s+(.+)$/i);
    const company = roleAtCompany ? roleAtCompany[2].trim() : `${provider} listing`;
    if (roleAtCompany) role = roleAtCompany[1].trim();
    const location = plainContext.match(/\b(Remote|India|Bengaluru|Bangalore|Hyderabad|Pune|Gurugram|Gurgaon|Noida|Chennai|Mumbai|Delhi NCR|Delhi)\b/i)?.[0] ?? "India";
    const description = `${role} at ${company}. ${plainContext}`.slice(0, 4_000);
    candidates.push({
      externalId: applicationUrl, company: company.slice(0, 120), role: role.slice(0, 180), location,
      workMode: inferWorkMode(location, description), platform: provider, applicationUrl, description,
    });
    seen.add(applicationUrl);
  };

  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of content.matchAll(anchorPattern)) {
    const index = match.index ?? 0;
    addCandidate(match[1], match[2], content.slice(Math.max(0, index - 700), Math.min(content.length, index + match[0].length + 700)));
  }
  const urlPattern = /https:\/\/[^\s<>"']+/gi;
  for (const match of content.matchAll(urlPattern)) {
    const index = match.index ?? 0;
    addCandidate(match[0], "", content.slice(Math.max(0, index - 700), Math.min(content.length, index + match[0].length + 500)));
  }
  return candidates.slice(0, 100);
}

async function alertMessageKey(body: Record<string, unknown>, provider: string) {
  const supplied = asString(body.messageId || body.messageKey).trim();
  if (supplied) return supplied.slice(0, 240);
  const source = `${provider}\n${asString(body.subject)}\n${asString(body.content || body.html || body.text)}\n${JSON.stringify(body.jobs ?? [])}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function importPortalAlert(
  body: Record<string, unknown>,
  env: Env,
  user: { id: string; email: string; name: string },
  startedAt: string,
) {
  const provider = asString(body.provider, "Job alert").slice(0, 60);
  const subject = asString(body.subject, `${provider} job alert`).slice(0, 240);
  const messageKey = await alertMessageKey(body, provider);
  const existing = await env.DB.prepare(
    "SELECT * FROM alert_imports WHERE user_id = ? AND message_key = ?",
  ).bind(user.id, messageKey).first<Record<string, unknown>>();
  if (existing) return { duplicate: true, alertImport: rowToAlertImport(existing), run: null };

  const inputs = extractJobsFromAlert(body, provider);
  if (!inputs.length) throw new Error("No job links were recognized. Paste the complete alert email or provide structured jobs.");
  const search = await env.DB.prepare(
    "SELECT min_score FROM discovery_searches WHERE user_id = ? AND active = 1 ORDER BY updated_at DESC LIMIT 1",
  ).bind(user.id).first<Record<string, unknown>>();
  const minScore = Math.max(65, Math.min(95, Number(search?.min_score ?? 75)));
  const profile = await profileForUser(env, user);
  const rows: Array<Record<string, unknown>> = [];
  let duplicates = 0;
  for (const input of inputs) {
    const scored = scoreJob(profile, input);
    const saved = await saveScoredJob(env, user.id, scored, null, new Date().toISOString());
    if (saved.duplicate) duplicates += 1;
    const row = await env.DB.prepare("SELECT * FROM job_matches WHERE id = ? AND user_id = ?").bind(saved.id, user.id).first<Record<string, unknown>>();
    if (row) rows.push(row);
  }
  rows.sort((left, right) => Number(right.match_score) - Number(left.match_score));
  const qualified = rows.filter((row) => Number(row.match_score) >= minScore && row.status !== "SKIPPED");
  const runId = crypto.randomUUID();
  const completedAt = new Date().toISOString();
  const autoStaged = await autoStageJobs(rows, env, user, minScore);
  const alertsCreated = await createJobAlerts(env, user.id, runId, qualified, minScore, completedAt);
  const imported = Math.max(0, rows.length - duplicates);
  const providerReport = [{ provider: `${provider} alerts`, discovered: inputs.length, relevant: rows.length, imported, duplicates }];
  const report = {
    provider, subject, topOpportunities: rows.slice(0, 10).map(rowToJob),
    highestPriority: selectHighestPriority(qualified, 3).map(rowToJob), autoStaged, alertsCreated,
  };
  const importId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO discovery_runs
       (id, user_id, search_id, mode, status, providers_json, discovered, imported,
        duplicates, qualified, report_json, started_at, completed_at)
       VALUES (?, ?, NULL, 'PORTAL_ALERT', 'COMPLETED', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(runId, user.id, JSON.stringify(providerReport), inputs.length, imported, duplicates, qualified.length, JSON.stringify(report), startedAt, completedAt),
    env.DB.prepare(
      `INSERT INTO alert_imports
       (id, user_id, provider, message_key, subject, status, jobs_found, imported, duplicates, created_at)
       VALUES (?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?)`,
    ).bind(importId, user.id, provider, messageKey, subject, inputs.length, imported, duplicates, completedAt),
  ]);
  return {
    duplicate: false,
    alertImport: rowToAlertImport({ id: importId, provider, subject, status: "COMPLETED", jobs_found: inputs.length, imported, duplicates, created_at: completedAt }),
    run: rowToDiscoveryRun({ id: runId, user_id: user.id, search_id: null, mode: "PORTAL_ALERT", status: "COMPLETED", providers_json: JSON.stringify(providerReport), discovered: inputs.length, imported, duplicates, qualified: qualified.length, report_json: JSON.stringify(report), started_at: startedAt, completed_at: completedAt }),
  };
}

async function importPortalCapture(
  body: Record<string, unknown>,
  env: Env,
  user: { id: string; email: string; name: string },
  startedAt: string,
) {
  const batch = typeof body.batch === "object" && body.batch ? body.batch as Record<string, unknown> : body;
  const jobs = Array.isArray(batch.jobs) ? batch.jobs.slice(0, 100) as Array<Record<string, unknown>> : [];
  if (!jobs.length) throw new Error("Paste a browser companion discovery batch containing at least one job.");
  const sourceUrl = asString(batch.sourceUrl);
  const portal = asString(batch.portal, "Portal capture").slice(0, 40);
  const profile = await profileForUser(env, user);
  const importedRows: Array<Record<string, unknown>> = [];
  let duplicates = 0;
  let rejected = 0;
  for (const job of jobs) {
    const applicationUrl = asString(job.applicationUrl || job.url);
    let target: URL;
    try { target = new URL(applicationUrl); } catch { rejected += 1; continue; }
    if (target.protocol !== "https:" || isPrivateHostname(target.hostname)) { rejected += 1; continue; }
    const role = asString(job.role || job.title).slice(0, 180);
    if (!role) { rejected += 1; continue; }
    const company = asString(job.company, companyFromUrl(applicationUrl)).slice(0, 120);
    const location = asString(job.location, "Not specified").slice(0, 160);
    const description = asString(job.description || job.cardText, `${role} at ${company}. Captured from a signed-in ${portal} search results page.`).slice(0, 20_000);
    const input: JobInput = {
      externalId: asString(job.externalId), company, role, location,
      workMode: asString(job.workMode, inferWorkMode(location, description)),
      platform: portal, applicationUrl, postedDate: asString(job.postedDate), description,
      compensation: asString(job.compensation),
    };
    const scored = scoreJob(profile, input);
    const saved = await saveScoredJob(env, user.id, scored, null, new Date().toISOString());
    if (saved.duplicate) duplicates += 1;
    const row = await env.DB.prepare("SELECT * FROM job_matches WHERE id = ? AND user_id = ?").bind(saved.id, user.id).first<Record<string, unknown>>();
    if (row) importedRows.push(row);
  }
  const runId = crypto.randomUUID();
  const qualifiedRows = importedRows.filter((row) => Number(row.match_score) >= 75 && row.status !== "SKIPPED");
  const autoStaged = await autoStageJobs(importedRows.sort((a, b) => Number(b.match_score) - Number(a.match_score)), env, user, 75);
  const completedAt = new Date().toISOString();
  const alertsCreated = await createJobAlerts(env, user.id, runId, qualifiedRows, 75, completedAt);
  const report = {
    sourceUrl,
    portal,
    rejected,
    topOpportunities: importedRows.sort((a, b) => Number(b.match_score) - Number(a.match_score)).slice(0, 10).map(rowToJob),
    highestPriority: selectHighestPriority(qualifiedRows, 3).map(rowToJob),
    autoStaged,
    alertsCreated,
  };
  await env.DB.prepare(
    `INSERT INTO discovery_runs
     (id, user_id, search_id, mode, status, providers_json, discovered, imported,
      duplicates, qualified, report_json, started_at, completed_at)
     VALUES (?, ?, NULL, 'PORTAL_CAPTURE', 'COMPLETED', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    runId, user.id, JSON.stringify([{ provider: portal, discovered: jobs.length, imported: importedRows.length - duplicates, duplicates }]),
    jobs.length, importedRows.length - duplicates, duplicates, qualifiedRows.length, JSON.stringify(report), startedAt, completedAt,
  ).run();
  return rowToDiscoveryRun({
    id: runId, user_id: user.id, search_id: null, mode: "PORTAL_CAPTURE", status: "COMPLETED",
    providers_json: JSON.stringify([{ provider: portal, discovered: jobs.length, imported: importedRows.length - duplicates, duplicates }]),
    discovered: jobs.length, imported: importedRows.length - duplicates, duplicates, qualified: qualifiedRows.length,
    report_json: JSON.stringify(report), started_at: startedAt, completed_at: completedAt,
  });
}

function buildBrowserPacket(profile: CandidateProfile, job: Record<string, unknown>, packet: Record<string, unknown>) {
  const names = profile.name.trim().split(/\s+/);
  return {
    schemaVersion: 1,
    packetId: packet.id,
    applicationUrl: job.application_url,
    allowedHost: (() => { try { return new URL(asString(job.application_url)).hostname; } catch { return ""; } })(),
    job: { company: job.company, role: job.role, location: job.location, score: job.match_score },
    fields: {
      full_name: profile.name,
      first_name: names[0] ?? "",
      last_name: names.slice(1).join(" "),
      email: profile.email,
      current_company: asString(parseJson<Record<string, unknown>>(packet.answers_json, {}).current_company),
      current_title: profile.title,
    },
    answers: parseJson(packet.answers_json, {}),
    blockers: parseJson(packet.blockers_json, []),
    policy: {
      fillSupportedFields: true,
      stopOnUnknownRequiredField: true,
      neverBypassCaptcha: true,
      neverSubmit: true,
    },
  };
}

async function prepareApplication(
  body: Record<string, unknown>,
  env: Env,
  user: { id: string; email: string; name: string },
  now: string,
) {
  const activeEvidence = await requireActiveEvidence(env, user.id);
  const jobId = asString(body.jobId);
  const job = await env.DB.prepare(
    "SELECT * FROM job_matches WHERE id = ? AND user_id = ?",
  ).bind(jobId, user.id).first<Record<string, unknown>>();
  if (!job) throw new Error("That job is no longer available in your workspace.");
  await assertCurrentEvidence(env, user.id, job.profile_version_id);
  if (Number(job.match_score) < 70 || job.status === "SKIPPED") throw new Error("Only jobs scoring 70 or higher can enter the application queue.");
  const scored = parseJson<ScoredJob>(job.score_json, {} as ScoredJob);
  const questions = Array.isArray(body.requiredQuestions) ? body.requiredQuestions.map((item) => asString(item)).filter(Boolean) : [];
  const unknownPattern = /compensation|salary|ctc|notice period|authorization|visa|sponsor|relocat|demographic|gender|disability|veteran|legal|criminal/i;
  const vault = await answersForUser(env, user.id);
  const blockers = questions
    .filter((question) => {
      const key = answerKeyForQuestion(question);
      return unknownPattern.test(question) && (!key || !vault.values[key]);
    })
    .map((question) => ({
      id: answerKeyForQuestion(question) || crypto.randomUUID(), question, status: "NEEDS_INPUT",
    }));
  const profile = await profileForUser(env, user);
  const answers = {
    full_name: profile.name,
    email: profile.email,
    current_title: profile.title,
    ...vault.values,
  };
  const resumeStrategy = {
    fit: scored.resumeFit ?? "DEFAULT",
    changes: (scored.resumeChanges ?? []).slice(0, 5),
    evidence: (scored.matchingExperience ?? []).slice(0, 5),
  };
  const packetId = crypto.randomUUID();
  const status = blockers.length ? "NEEDS_INPUT" : "READY_FOR_REVIEW";
  await env.DB.prepare(
    `INSERT INTO application_packets
     (id, user_id, job_id, profile_version_id, resume_id, status, answers_json, blockers_json, resume_strategy_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, job_id) DO UPDATE SET
       profile_version_id = excluded.profile_version_id,
       resume_id = excluded.resume_id,
       status = excluded.status,
       answers_json = excluded.answers_json,
       blockers_json = excluded.blockers_json,
       resume_strategy_json = excluded.resume_strategy_json,
       updated_at = excluded.updated_at`,
  ).bind(packetId, user.id, jobId, activeEvidence.profileVersionId, activeEvidence.resumeId || null, status, JSON.stringify(answers), JSON.stringify(blockers), JSON.stringify(resumeStrategy), now, now).run();
  const saved = await env.DB.prepare(
    "SELECT * FROM application_packets WHERE user_id = ? AND job_id = ?",
  ).bind(user.id, jobId).first<Record<string, unknown>>();
  const kit = buildApplicationKit(profile, job, scored, asString(saved?.id), answers);
  const kitId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO application_kits
     (id, user_id, job_id, packet_id, profile_version_id, resume_id, summary, why_answer, resume_changes_json,
       evidence_json, form_answers_json, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, job_id) DO UPDATE SET
       packet_id = excluded.packet_id,
       profile_version_id = excluded.profile_version_id,
       resume_id = excluded.resume_id,
       summary = excluded.summary,
       why_answer = excluded.why_answer,
       resume_changes_json = excluded.resume_changes_json,
       evidence_json = excluded.evidence_json,
       form_answers_json = excluded.form_answers_json,
       status = excluded.status,
       updated_at = excluded.updated_at`,
  ).bind(
    kitId, user.id, jobId, saved?.id, activeEvidence.profileVersionId, activeEvidence.resumeId || null, kit.summary, kit.whyAnswer,
    JSON.stringify(kit.resumeChanges), JSON.stringify(kit.evidence),
    JSON.stringify(kit.formAnswers), kit.status, now, now,
  ).run();
  const savedKit = await env.DB.prepare(
    "SELECT * FROM application_kits WHERE user_id = ? AND job_id = ?",
  ).bind(user.id, jobId).first<Record<string, unknown>>();
  await env.DB.prepare(
    "INSERT INTO application_events (id, packet_id, user_id, event_type, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), saved?.id, user.id, "PREPARED", JSON.stringify({ score: job.match_score, blockers: blockers.length }), now).run();
  return {
    ...rowToPacket({
      ...saved,
      company: job.company,
      role: job.role,
      application_url: job.application_url,
      match_score: job.match_score,
      kit_id: savedKit?.id,
      kit_summary: savedKit?.summary,
      kit_why_answer: savedKit?.why_answer,
      kit_resume_changes_json: savedKit?.resume_changes_json,
      kit_evidence_json: savedKit?.evidence_json,
      kit_form_answers_json: savedKit?.form_answers_json,
      kit_status: savedKit?.status,
    }),
    browserPacket: buildBrowserPacket(profile, job, saved ?? {}),
  };
}

function addHours(value: string, hours: number) {
  return new Date(new Date(value).getTime() + hours * 60 * 60 * 1000).toISOString();
}

function discoveryBodyFromRow(row: Record<string, unknown>) {
  return {
    name: asString(row.name, "Backend roles / India + Remote"),
    keywords: parseJson(row.keywords_json, ["Backend Engineer", "Software Engineer", "Platform Engineer", "Node.js"]),
    locations: parseJson(row.locations_json, ["India", "Remote", "APAC"]),
    workModes: parseJson(row.work_modes_json, ["Remote", "Hybrid"]),
    portals: parseJson(row.portals_json, ["Jobicy", "Arbeitnow", "Connected ATS boards"]),
    minScore: Number(row.min_score ?? 75),
    mode: "SCHEDULED",
    force: true,
  };
}

async function runAutomationForUser(
  env: Env,
  user: { id: string; email: string; name: string },
  now: string,
) {
  const settings = await env.DB.prepare("SELECT * FROM automation_settings WHERE user_id = ?").bind(user.id).first<Record<string, unknown>>();
  const cadenceHours = Math.max(6, Math.min(168, Number(settings?.cadence_hours ?? 24)));
  const search = await env.DB.prepare(
    "SELECT * FROM discovery_searches WHERE user_id = ? AND active = 1 ORDER BY updated_at DESC LIMIT 1",
  ).bind(user.id).first<Record<string, unknown>>();
  if (!search) throw new Error("Run and save a discovery search before starting scheduled automation.");
  try {
    const minScore = Math.max(75, Math.min(95, Number(settings?.min_score ?? search.min_score ?? 82)));
    const run = await runDiscovery({ ...discoveryBodyFromRow(search), minScore }, env, user, now);
    const completedAt = asString(run.completedAt, new Date().toISOString());
    await env.DB.prepare(
      `INSERT INTO automation_settings
       (user_id, enabled, cadence_hours, min_score, browser_alerts, last_run_at, next_run_at, last_status, last_error, updated_at)
       VALUES (?, 1, ?, ?, 1, ?, ?, 'COMPLETED', NULL, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         last_run_at = excluded.last_run_at,
         next_run_at = excluded.next_run_at,
         last_status = excluded.last_status,
         last_error = NULL,
         updated_at = excluded.updated_at`,
    ).bind(user.id, cadenceHours, minScore, completedAt, addHours(completedAt, cadenceHours), completedAt).run();
    const executionSettings = await env.DB.prepare("SELECT enabled FROM execution_settings WHERE user_id = ?").bind(user.id).first<Record<string, unknown>>();
    if (Boolean(executionSettings?.enabled)) await queueQualifiedExecutions(env, user, completedAt);
    return run;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scheduled discovery failed.";
    await env.DB.prepare(
      `UPDATE automation_settings SET last_status = 'FAILED', last_error = ?, next_run_at = ?, updated_at = ? WHERE user_id = ?`,
    ).bind(message.slice(0, 500), addHours(now, cadenceHours), now, user.id).run();
    throw error;
  }
}

async function executeDueAutomations(env: Env, now: string, onlyUserId?: string) {
  const result = onlyUserId
    ? await env.DB.prepare(
      `SELECT a.*, u.email, u.display_name FROM automation_settings a
       JOIN users u ON u.user_id = a.user_id
       WHERE a.enabled = 1 AND a.next_run_at <= ? AND a.user_id = ? LIMIT 1`,
    ).bind(now, onlyUserId).all<Record<string, unknown>>()
    : await env.DB.prepare(
      `SELECT a.*, u.email, u.display_name FROM automation_settings a
       JOIN users u ON u.user_id = a.user_id
       WHERE a.enabled = 1 AND a.next_run_at <= ? ORDER BY a.next_run_at LIMIT 20`,
    ).bind(now).all<Record<string, unknown>>();
  const outcomes: Array<{ userId: string; status: string; message?: string }> = [];
  for (const row of result.results) {
    const user = { id: asString(row.user_id), email: asString(row.email), name: asString(row.display_name, "RoleSignal user") };
    const cadenceHours = Math.max(6, Math.min(168, Number(row.cadence_hours ?? 24)));
    const claim = await env.DB.prepare(
      "UPDATE automation_settings SET next_run_at = ?, last_status = 'RUNNING', updated_at = ? WHERE user_id = ? AND enabled = 1 AND next_run_at <= ?",
    ).bind(addHours(now, cadenceHours), now, user.id, now).run();
    if (Number(claim.meta?.changes ?? 0) === 0) continue;
    try {
      await runAutomationForUser(env, user, now);
      outcomes.push({ userId: user.id, status: "COMPLETED" });
    } catch (error) {
      outcomes.push({ userId: user.id, status: "FAILED", message: error instanceof Error ? error.message : "Scheduled discovery failed." });
    }
  }
  return outcomes;
}

async function queueExecutionForJob(
  env: Env,
  user: { id: string; email: string; name: string },
  job: Record<string, unknown>,
  settings: ReturnType<typeof rowToExecutionSettings>,
  now: string,
) {
  const active = await requireActiveEvidence(env, user.id);
  await assertCurrentEvidence(env, user.id, job.profile_version_id);
  const existing = await env.DB.prepare(
    "SELECT * FROM application_executions WHERE user_id = ? AND job_id = ?",
  ).bind(user.id, job.id).first<Record<string, unknown>>();
  if (existing?.status === "SUBMITTED") return { execution: rowToExecution({ ...existing, company: job.company, role: job.role, location: job.location, match_score: job.match_score }), created: false };

  const packet = await env.DB.prepare(
    "SELECT * FROM application_packets WHERE user_id = ? AND job_id = ? AND profile_version_id = ?",
  ).bind(user.id, job.id, active.profileVersionId).first<Record<string, unknown>>();
  if (!packet || packet.status !== "APPROVED_FOR_FILL") throw new Error("Review and approve this application packet before queueing browser fill.");
  const packetId = asString(packet.id);
  const blockers = parseJson<unknown[]>(packet.blockers_json, []);

  const document = await env.DB.prepare(
    `SELECT * FROM tailored_documents
     WHERE user_id = ? AND job_id = ? AND profile_version_id = ? AND status = 'APPROVED'
     ORDER BY version DESC LIMIT 1`,
  ).bind(user.id, job.id, active.profileVersionId).first<Record<string, unknown>>();
  const capability = executionCapability(asString(job.application_url), asString(job.platform));
  const mode = effectiveExecutionMode(settings.mode as ExecutionMode, capability);
  const status = blockers.length ? "NEEDS_INPUT" : settings.requireTailoredResume && !document ? "NEEDS_DOCUMENT" : "QUEUED";
  const id = asString(existing?.id, crypto.randomUUID());
  await env.DB.prepare(
    `INSERT INTO application_executions
     (id, user_id, job_id, packet_id, document_id, profile_version_id, resume_id, device_id, platform, mode, status,
       attempt_count, fields_filled, unknown_required_json, last_error, application_url,
       created_at, updated_at, claimed_at, completed_at, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 0, 0, ?, NULL, ?, ?, ?, NULL, NULL, NULL)
     ON CONFLICT(user_id, job_id) DO UPDATE SET
       packet_id = excluded.packet_id,
       document_id = excluded.document_id,
       profile_version_id = excluded.profile_version_id,
       resume_id = excluded.resume_id,
       platform = excluded.platform,
       mode = excluded.mode,
       status = CASE WHEN application_executions.status = 'SUBMITTED' THEN 'SUBMITTED' ELSE excluded.status END,
       unknown_required_json = excluded.unknown_required_json,
       last_error = NULL,
       application_url = excluded.application_url,
       updated_at = excluded.updated_at,
       claimed_at = NULL,
       completed_at = NULL`,
  ).bind(
    id, user.id, job.id, packetId, document?.id ?? null, active.profileVersionId, active.resumeId || null, capability.portal, mode, status,
    JSON.stringify(blockers.map((blocker) => typeof blocker === "object" && blocker ? (blocker as Record<string, unknown>).question : String(blocker))),
    job.application_url, now, now,
  ).run();
  const saved = await env.DB.prepare(
    `SELECT e.*, j.company, j.role, j.location, j.match_score, d.version AS document_version
     FROM application_executions e JOIN job_matches j ON j.id = e.job_id
     LEFT JOIN tailored_documents d ON d.id = e.document_id
     WHERE e.id = ? AND e.user_id = ?`,
  ).bind(id, user.id).first<Record<string, unknown>>();
  return { execution: saved ? rowToExecution(saved) : null, created: !existing, capability };
}

async function queueQualifiedExecutions(
  env: Env,
  user: { id: string; email: string; name: string },
  now: string,
) {
  const active = await requireActiveEvidence(env, user.id);
  const settingsRow = await env.DB.prepare("SELECT * FROM execution_settings WHERE user_id = ?").bind(user.id).first<Record<string, unknown>>();
  const settings = rowToExecutionSettings(settingsRow);
  if (!settings.enabled) throw new Error("Enable guarded browser fill before queueing qualified jobs.");
  const startOfDay = `${now.slice(0, 10)}T00:00:00.000Z`;
  const countRow = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM application_executions WHERE user_id = ? AND profile_version_id = ? AND created_at >= ?",
  ).bind(user.id, active.profileVersionId, startOfDay).first<Record<string, unknown>>();
  const remaining = Math.max(0, settings.dailyLimit - Number(countRow?.count ?? 0));
  if (!remaining) return { queued: [], dailyLimitReached: true, remaining: 0 };
  const jobs = await env.DB.prepare(
    `SELECT j.* FROM job_matches j
     JOIN application_packets p ON p.user_id = j.user_id AND p.job_id = j.id
     LEFT JOIN application_executions e ON e.user_id = j.user_id AND e.job_id = j.id
     JOIN career_profiles cp ON cp.user_id = j.user_id
     WHERE j.user_id = ? AND j.match_score >= ? AND j.status != 'SKIPPED'
       AND j.profile_version_id = cp.active_profile_version_id
       AND p.profile_version_id = cp.active_profile_version_id AND p.status = 'APPROVED_FOR_FILL'
       AND (e.id IS NULL OR e.status IN ('FAILED', 'NEEDS_INPUT', 'NEEDS_DOCUMENT', 'READY_TO_SUBMIT'))
     ORDER BY j.match_score DESC, j.updated_at DESC LIMIT ?`,
  ).bind(user.id, settings.minScore, remaining).all<Record<string, unknown>>();
  const queued = [];
  for (const job of jobs.results) queued.push(await queueExecutionForJob(env, user, job, settings, now));
  return { queued, dailyLimitReached: false, remaining: Math.max(0, remaining - queued.length) };
}

async function buildExecutionPacket(
  env: Env,
  user: { id: string; email: string; name: string },
  row: Record<string, unknown>,
) {
  await assertCurrentEvidence(env, user.id, row.profile_version_id);
  const profile = await profileForUser(env, user);
  const vault = await answersForUser(env, user.id);
  const packet = {
    ...row,
    answers_json: JSON.stringify({ ...parseJson(row.answers_json, {}), ...vault.values }),
  };
  const base = buildBrowserPacket(profile, row, packet);
  return {
    ...base,
    schemaVersion: 2,
    executionId: row.execution_id,
    mode: row.execution_mode,
    approvedResume: row.document_id ? {
      filename: `${asString(row.company)}-${asString(row.role)}-RoleSignal.pdf`.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 140),
      downloadPath: `/api/rolesignal/companion/resume?id=${encodeURIComponent(asString(row.execution_id))}`,
    } : null,
    policy: {
      fillSupportedFields: true,
      stopOnUnknownRequiredField: true,
      neverBypassCaptcha: true,
      allowAutoSubmit: false,
      requireSubmissionConfirmation: true,
    },
  };
}

async function handleRoleSignalApi(request: Request, env: Env, url: URL, ctx: ExecutionContext) {
  try {
    await ensureSchema(env);
    const now = new Date().toISOString();

    if (url.pathname === "/api/rolesignal/inbound-email" && request.method === "POST") {
      if (!env.INBOUND_EMAIL_SECRET) return json({ error: "Inbound job alerts are not configured." }, 404);
      if (request.headers.get("authorization") !== `Bearer ${env.INBOUND_EMAIL_SECRET}`) return json({ error: "Invalid inbound email credential." }, 401);
      const body = await request.json() as Record<string, unknown>;
      const userId = asString(body.userId).slice(0, 180);
      if (!userId) return json({ error: "An authenticated RoleSignal userId is required." }, 400);
      const account = await env.DB.prepare("SELECT * FROM users WHERE user_id = ?").bind(userId).first<Record<string, unknown>>();
      if (!account) return json({ error: "The RoleSignal account was not found." }, 404);
      const user = { id: userId, email: asString(account.email), name: asString(account.display_name, "RoleSignal user") };
      return json(await importPortalAlert(body, env, user, now), 201);
    }

    if (url.pathname.startsWith("/api/rolesignal/companion/") && request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: companionCors() });
    }

    if (url.pathname.startsWith("/api/rolesignal/companion/")) {
      const device = await companionDeviceForRequest(request, env);
      if (!device) return companionJson({ error: "The companion connection key is invalid or has been revoked." }, 401);
      const companionUser = await env.DB.prepare("SELECT * FROM users WHERE user_id = ?").bind(device.user_id).first<Record<string, unknown>>();
      const user = {
        id: asString(device.user_id),
        email: asString(companionUser?.email),
        name: asString(companionUser?.display_name, "RoleSignal user"),
      };
      await env.DB.prepare("UPDATE companion_devices SET last_seen_at = ? WHERE id = ?").bind(now, device.id).run();

      if (url.pathname === "/api/rolesignal/companion/claim" && request.method === "POST") {
        const staleBefore = new Date(Date.now() - 15 * 60 * 1000).toISOString();
        await env.DB.prepare(
          "UPDATE application_executions SET status = 'QUEUED', device_id = NULL, claimed_at = NULL, updated_at = ? WHERE user_id = ? AND status = 'CLAIMED' AND claimed_at < ?",
        ).bind(now, user.id, staleBefore).run();
        const candidate = await env.DB.prepare(
          `SELECT e.id FROM application_executions e JOIN career_profiles cp ON cp.user_id = e.user_id
           WHERE e.user_id = ? AND e.status = 'QUEUED' AND e.profile_version_id = cp.active_profile_version_id
           ORDER BY e.created_at ASC LIMIT 1`,
        ).bind(user.id).first<Record<string, unknown>>();
        if (!candidate) return companionJson({ execution: null, message: "No approved applications are waiting." });
        const claim = await env.DB.prepare(
          `UPDATE application_executions SET status = 'CLAIMED', device_id = ?, claimed_at = ?,
           updated_at = ?, attempt_count = attempt_count + 1 WHERE id = ? AND user_id = ? AND status = 'QUEUED'`,
        ).bind(device.id, now, now, candidate.id, user.id).run();
        if (!claim.meta.changes) return companionJson({ execution: null, message: "The next application was claimed by another device." }, 409);
        const row = await env.DB.prepare(
          `SELECT e.id AS execution_id, e.mode AS execution_mode, e.document_id,
                  p.id, p.answers_json, p.blockers_json,
                  j.id AS job_id, j.company, j.role, j.location, j.application_url, j.match_score
           FROM application_executions e
           JOIN application_packets p ON p.id = e.packet_id
           JOIN job_matches j ON j.id = e.job_id
           WHERE e.id = ? AND e.user_id = ?`,
        ).bind(candidate.id, user.id).first<Record<string, unknown>>();
        if (!row) return companionJson({ error: "The claimed application packet is incomplete." }, 409);
        return companionJson({ execution: await buildExecutionPacket(env, user, row) });
      }

      if (url.pathname === "/api/rolesignal/companion/report" && request.method === "POST") {
        const body = await request.json() as Record<string, unknown>;
        const executionId = asString(body.executionId);
        const row = await env.DB.prepare(
          "SELECT * FROM application_executions WHERE id = ? AND user_id = ? AND device_id = ?",
        ).bind(executionId, user.id, device.id).first<Record<string, unknown>>();
        if (!row) return companionJson({ error: "This execution is not assigned to the connected device." }, 404);
        const unknownRequired = Array.isArray(body.unknownRequired) ? body.unknownRequired.map((item) => asString(item).slice(0, 300)).filter(Boolean).slice(0, 40) : [];
        const report = {
          outcome: asString(body.outcome),
          unknownRequired,
          captchaDetected: body.captchaDetected === true,
          submissionConfirmed: body.submissionConfirmed === true,
        };
        const status = executionStatusFromReport(report);
        const fieldsFilled = Math.max(0, Math.min(200, Number(body.fieldsFilled ?? 0)));
        const lastError = asString(body.error).slice(0, 1_000) || null;
        const completedAt = ["SUBMITTED", "READY_TO_SUBMIT", "NEEDS_INPUT", "FAILED"].includes(status) ? now : null;
        await env.DB.batch([
          env.DB.prepare(
            `UPDATE application_executions SET status = ?, fields_filled = ?, unknown_required_json = ?,
             last_error = ?, updated_at = ?, completed_at = ?, submitted_at = CASE WHEN ? = 'SUBMITTED' THEN ? ELSE submitted_at END
             WHERE id = ? AND user_id = ?`,
          ).bind(status, fieldsFilled, JSON.stringify(unknownRequired), lastError, now, completedAt, status, now, executionId, user.id),
          env.DB.prepare("UPDATE application_packets SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?")
            .bind(status === "SUBMITTED" ? "SUBMITTED" : status, now, row.packet_id, user.id),
          env.DB.prepare("INSERT INTO application_events (id, packet_id, user_id, event_type, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(crypto.randomUUID(), row.packet_id, user.id, `EXECUTION_${status}`, JSON.stringify({ fieldsFilled, unknownRequired, captchaDetected: report.captchaDetected, lastError }), now),
        ]);
        return companionJson({ saved: true, status });
      }

      if (url.pathname === "/api/rolesignal/companion/resume" && request.method === "GET") {
        const executionId = url.searchParams.get("id") ?? "";
        const row = await env.DB.prepare(
          `SELECT e.*, d.pdf_object_key, j.company, j.role
           FROM application_executions e
           LEFT JOIN tailored_documents d ON d.id = e.document_id AND d.user_id = e.user_id
           JOIN job_matches j ON j.id = e.job_id
           WHERE e.id = ? AND e.user_id = ? AND e.device_id = ?`,
        ).bind(executionId, user.id, device.id).first<Record<string, unknown>>();
        if (!row) return companionJson({ error: "The resume is not available for this execution." }, 404);
        let objectKey = asString(row.pdf_object_key);
        let filename = `${asString(row.company)}-${asString(row.role)}-RoleSignal.pdf`.replace(/[^a-zA-Z0-9._-]+/g, "-");
        let contentType = "application/pdf";
        if (!objectKey) {
          const resume = await env.DB.prepare("SELECT * FROM resumes WHERE user_id = ? ORDER BY created_at DESC LIMIT 1").bind(user.id).first<Record<string, unknown>>();
          objectKey = asString(resume?.object_key);
          filename = asString(resume?.filename, "resume.pdf");
          contentType = asString(resume?.content_type, "application/octet-stream");
        }
        if (!objectKey) return companionJson({ error: "Upload or approve a resume before automatic execution." }, 409);
        const object = await env.RESUMES.get(objectKey);
        if (!object) return companionJson({ error: "The approved resume file could not be found." }, 404);
        const headers = new Headers(companionCors());
        headers.set("content-type", contentType);
        headers.set("content-disposition", `attachment; filename="${filename.slice(0, 160)}"`);
        object.writeHttpMetadata(headers);
        return new Response(object.body, { headers });
      }

      return companionJson({ error: "Companion endpoint not found." }, 404);
    }

    const user = currentUser(request);

    await env.DB.prepare(
      `INSERT INTO users (user_id, email, display_name, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, display_name = excluded.display_name`,
    ).bind(user.id, user.email, user.name, now).run();

    if (url.pathname === "/api/rolesignal/workspace" && request.method === "GET") {
      ctx.waitUntil(executeDueAutomations(env, now, user.id));
      const activeEvidence = await activeEvidenceForUser(env, user.id);
      const activeProfileVersionId = activeEvidence?.profileVersionId ?? "__no_active_profile__";
      const activeSince = activeEvidence?.activatedAt || "9999-12-31T23:59:59.999Z";
      const pendingProfile = await pendingProfileForUser(env, user.id);
      const [resumes, preferences, profile, matches, sources, packets, vault, runs, discoverySearches, discoveryRuns, automation, alerts, alertImports, studioDocuments, executionSettings, devices, executions, healthRows] = await Promise.all([
        env.DB.prepare(
          `SELECT id, filename, content_type, size_bytes, status, created_at
           FROM resumes WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`,
        ).bind(user.id).all(),
        env.DB.prepare("SELECT * FROM preferences WHERE user_id = ?").bind(user.id).first(),
        profileForUser(env, user),
        env.DB.prepare("SELECT * FROM job_matches WHERE user_id = ? AND profile_version_id = ? AND status != 'STALE' ORDER BY match_score DESC, updated_at DESC LIMIT 200").bind(user.id, activeProfileVersionId).all(),
        env.DB.prepare("SELECT * FROM job_sources WHERE user_id = ? AND active = 1 ORDER BY created_at DESC").bind(user.id).all(),
        env.DB.prepare(
          `SELECT p.*, j.company, j.role, j.application_url, j.match_score,
                  k.id AS kit_id, k.summary AS kit_summary, k.why_answer AS kit_why_answer,
                  k.resume_changes_json AS kit_resume_changes_json,
                  k.evidence_json AS kit_evidence_json,
                  k.form_answers_json AS kit_form_answers_json,
                  k.status AS kit_status
           FROM application_packets p JOIN job_matches j ON j.id = p.job_id
           LEFT JOIN application_kits k ON k.user_id = p.user_id AND k.job_id = p.job_id
            WHERE p.user_id = ? AND p.profile_version_id = ? AND p.status != 'STALE' ORDER BY p.updated_at DESC`,
        ).bind(user.id, activeProfileVersionId).all(),
        answersForUser(env, user.id),
        env.DB.prepare(
          "SELECT * FROM search_runs WHERE user_id = ? AND started_at >= ? ORDER BY completed_at DESC, started_at DESC LIMIT 20",
        ).bind(user.id, activeSince).all(),
        env.DB.prepare(
          "SELECT * FROM discovery_searches WHERE user_id = ? AND active = 1 ORDER BY updated_at DESC LIMIT 20",
        ).bind(user.id).all(),
        env.DB.prepare(
          "SELECT * FROM discovery_runs WHERE user_id = ? AND started_at >= ? ORDER BY completed_at DESC, started_at DESC LIMIT 30",
        ).bind(user.id, activeSince).all(),
        env.DB.prepare("SELECT * FROM automation_settings WHERE user_id = ?").bind(user.id).first<Record<string, unknown>>(),
        env.DB.prepare(
          `SELECT a.* FROM job_alerts a JOIN job_matches j ON j.id = a.job_id
           WHERE a.user_id = ? AND j.profile_version_id = ? AND j.status != 'STALE' ORDER BY a.created_at DESC LIMIT 50`,
        ).bind(user.id, activeProfileVersionId).all(),
        env.DB.prepare(
          "SELECT * FROM alert_imports WHERE user_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 20",
        ).bind(user.id, activeSince).all(),
        env.DB.prepare(
          `SELECT d.*, j.company, j.role, j.location, j.match_score
           FROM tailored_documents d JOIN job_matches j ON j.id = d.job_id
            WHERE d.user_id = ? AND d.profile_version_id = ? AND d.status != 'STALE' ORDER BY d.updated_at DESC LIMIT 100`,
        ).bind(user.id, activeProfileVersionId).all(),
        env.DB.prepare("SELECT * FROM execution_settings WHERE user_id = ?").bind(user.id).first<Record<string, unknown>>(),
        env.DB.prepare("SELECT * FROM companion_devices WHERE user_id = ? ORDER BY created_at DESC LIMIT 10").bind(user.id).all<Record<string, unknown>>(),
        executionRows(env, user.id, activeProfileVersionId),
        env.DB.prepare("SELECT * FROM source_health WHERE user_id = ? ORDER BY provider").bind(user.id).all<Record<string, unknown>>(),
      ]);
      return json({
        user,
        resumes: resumes.results,
        preferences,
        profile,
        profileStatus: activeEvidence ? "VERIFIED" : pendingProfile ? "PENDING_REVIEW" : "EMPTY",
        activeProfileVersionId: activeEvidence?.profileVersionId ?? null,
        activeResumeId: activeEvidence?.resumeId ?? null,
        pendingProfileVersion: pendingProfile,
        jobs: (matches.results as Record<string, unknown>[]).map(rowToJob),
        sources: sources.results,
        packets: (packets.results as Record<string, unknown>[]).map(rowToPacket),
        answerVault: vault.rows,
        searchRuns: (runs.results as Record<string, unknown>[]).map(rowToRun),
        discoverySearches: (discoverySearches.results as Record<string, unknown>[]).map(rowToDiscoverySearch),
        discoveryRuns: (discoveryRuns.results as Record<string, unknown>[]).map(rowToDiscoveryRun),
        discoverySources: discoverySources(env, sources.results.length, healthRows.results),
        automation: rowToAutomation(automation),
        alerts: (alerts.results as Record<string, unknown>[]).map(rowToAlert),
        alertImports: (alertImports.results as Record<string, unknown>[]).map(rowToAlertImport),
        studioDocuments: (studioDocuments.results as Record<string, unknown>[]).map(rowToStudioDocument),
        executionSettings: rowToExecutionSettings(executionSettings),
        companionDevices: devices.results.map(rowToCompanionDevice),
        executions,
      });
    }

    if (url.pathname === "/api/rolesignal/resumes" && request.method === "POST") {
      const form = await request.formData();
      const candidateFile = form.get("resume");
      if (!(candidateFile instanceof File)) return json({ error: "Resume file is required." }, 400);
      if (candidateFile.size > 10 * 1024 * 1024) return json({ error: "Resume must be smaller than 10 MB." }, 413);
      const allowedTypes = new Set([
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain",
      ]);
      if (!allowedTypes.has(candidateFile.type)) return json({ error: "Upload a PDF, DOCX, or TXT file." }, 415);

      const bytes = await candidateFile.arrayBuffer();
      const id = crypto.randomUUID();
      const safeName = candidateFile.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const objectKey = `${user.id}/${id}-${safeName}`;
      const resumeText = asString(form.get("resumeText")) || (candidateFile.type === "text/plain" ? new TextDecoder().decode(bytes) : "");
      const profile = resumeText ? profileFromResumeText(resumeText.slice(0, 200_000), "", user.email) : null;
      const status = profile ? "awaiting_review" : "needs_text_extraction";
      const versionRow = await env.DB.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS version FROM career_profile_versions WHERE user_id = ?").bind(user.id).first<Record<string, unknown>>();
      const version = Number(versionRow?.version ?? 1);
      const profileVersionId = crypto.randomUUID();
      await env.RESUMES.put(objectKey, bytes, {
        httpMetadata: { contentType: candidateFile.type },
        customMetadata: { owner: user.id, originalName: candidateFile.name },
      });
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO resumes
           (id, user_id, object_key, filename, content_type, size_bytes, status, version, profile_version_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(id, user.id, objectKey, candidateFile.name, candidateFile.type, candidateFile.size, status, version, profileVersionId, now),
        env.DB.prepare(
          `INSERT INTO career_profile_versions
           (id, user_id, resume_id, version, status, raw_text, extracted_json, created_at, activated_at)
           VALUES (?, ?, ?, ?, 'PENDING_REVIEW', ?, ?, ?, NULL)`,
        ).bind(profileVersionId, user.id, id, version, resumeText, JSON.stringify(profile ?? EMPTY_PROFILE), now),
      ]);
      return json({ id, filename: candidateFile.name, size: candidateFile.size, status, profileVersion: { id: profileVersionId, resumeId: id, version, status: "PENDING_REVIEW", profile, createdAt: now } }, 201);
    }

    if (url.pathname === "/api/rolesignal/profile/analyze" && request.method === "POST") {
      const body = await request.json() as Record<string, unknown>;
      const resumeText = asString(body.resumeText).slice(0, 200_000);
      if (resumeText.length < 80) return json({ error: "Paste enough resume text to analyze accurately." }, 400);
      const profile = profileFromResumeText(resumeText, "", user.email);
      const versionRow = await env.DB.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS version FROM career_profile_versions WHERE user_id = ?").bind(user.id).first<Record<string, unknown>>();
      const version = Number(versionRow?.version ?? 1);
      const profileVersionId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO career_profile_versions
         (id, user_id, resume_id, version, status, raw_text, extracted_json, created_at, activated_at)
         VALUES (?, ?, NULL, ?, 'PENDING_REVIEW', ?, ?, ?, NULL)`,
      ).bind(profileVersionId, user.id, version, resumeText, JSON.stringify(profile), now).run();
      return json({ profileVersion: { id: profileVersionId, resumeId: null, version, status: "PENDING_REVIEW", profile, createdAt: now } }, 201);
    }

    if (url.pathname === "/api/rolesignal/profile/confirm" && request.method === "POST") {
      const body = await request.json() as Record<string, unknown>;
      const profileVersionId = asString(body.profileVersionId);
      const draft = await env.DB.prepare(
        "SELECT * FROM career_profile_versions WHERE id = ? AND user_id = ? AND status = 'PENDING_REVIEW'",
      ).bind(profileVersionId, user.id).first<Record<string, unknown>>();
      if (!draft) return json({ error: "The pending profile was not found or has already been reviewed." }, 404);
      const supplied = body.profile && typeof body.profile === "object" ? body.profile as Record<string, unknown> : parseJson<Record<string, unknown>>(draft.extracted_json, {});
      const profile: CandidateProfile = {
        name: asString(supplied.name).slice(0, 120),
        email: asString(supplied.email, user.email).slice(0, 200),
        title: asString(supplied.title, "Software Engineer").slice(0, 160),
        experienceYears: Math.max(0, Math.min(50, Number(supplied.experienceYears ?? 0))),
        skills: Array.isArray(supplied.skills) ? supplied.skills.map((item) => asString(item).slice(0, 100)).filter(Boolean).slice(0, 80) : [],
        domains: Array.isArray(supplied.domains) ? supplied.domains.map((item) => asString(item).slice(0, 160)).filter(Boolean).slice(0, 30) : [],
        evidence: Array.isArray(supplied.evidence) ? supplied.evidence.map((item) => asString(item).slice(0, 500)).filter(Boolean).slice(0, 30) : [],
        source: "resume",
      };
      if (!profile.name) return json({ error: "Confirm the candidate name before activating this profile." }, 400);
      if (!profile.skills.length && !profile.evidence.length) return json({ error: "Confirm at least one skill or evidence statement before activating this profile." }, 400);
      const resumeId = asString(draft.resume_id);
      await env.DB.batch([
        env.DB.prepare("UPDATE users SET display_name = ? WHERE user_id = ?").bind(profile.name, user.id),
        env.DB.prepare("UPDATE career_profile_versions SET status = 'SUPERSEDED' WHERE user_id = ? AND status = 'ACTIVE'").bind(user.id),
        env.DB.prepare("UPDATE career_profile_versions SET status = 'ACTIVE', extracted_json = ?, activated_at = ? WHERE id = ? AND user_id = ?").bind(JSON.stringify(profile), now, profileVersionId, user.id),
        env.DB.prepare(
          `INSERT INTO career_profiles (user_id, resume_id, active_profile_version_id, raw_text, extracted_json, status, updated_at)
           VALUES (?, ?, ?, ?, ?, 'VERIFIED', ?)
           ON CONFLICT(user_id) DO UPDATE SET resume_id = excluded.resume_id, active_profile_version_id = excluded.active_profile_version_id,
             raw_text = excluded.raw_text, extracted_json = excluded.extracted_json, status = excluded.status, updated_at = excluded.updated_at`,
        ).bind(user.id, resumeId || null, profileVersionId, draft.raw_text, JSON.stringify(profile), now),
        env.DB.prepare("UPDATE resumes SET status = CASE WHEN id = ? THEN 'active' ELSE 'superseded' END WHERE user_id = ?").bind(resumeId || "__none__", user.id),
        env.DB.prepare("UPDATE job_matches SET status = 'STALE' WHERE user_id = ? AND (profile_version_id IS NULL OR profile_version_id != ?)").bind(user.id, profileVersionId),
        env.DB.prepare("UPDATE application_packets SET status = 'STALE' WHERE user_id = ? AND (profile_version_id IS NULL OR profile_version_id != ?)").bind(user.id, profileVersionId),
        env.DB.prepare("UPDATE application_kits SET status = 'STALE' WHERE user_id = ? AND (profile_version_id IS NULL OR profile_version_id != ?)").bind(user.id, profileVersionId),
        env.DB.prepare("UPDATE tailored_documents SET status = 'STALE' WHERE user_id = ? AND status != 'SUPERSEDED' AND (profile_version_id IS NULL OR profile_version_id != ?)").bind(user.id, profileVersionId),
        env.DB.prepare("UPDATE application_executions SET status = 'STALE' WHERE user_id = ? AND status != 'SUBMITTED' AND (profile_version_id IS NULL OR profile_version_id != ?)").bind(user.id, profileVersionId),
      ]);
      return json({ confirmed: true, profile, activeProfileVersionId: profileVersionId, resumeId: resumeId || null });
    }

    if (url.pathname === "/api/rolesignal/preferences" && request.method === "POST") {
      const body = await request.json() as Record<string, unknown>;
      const threshold = Math.max(65, Math.min(95, Number(body.matchThreshold ?? 82)));
      const dailyLimit = Math.max(1, Math.min(20, Number(body.dailyLimit ?? 5)));
      const targetRoles = Array.isArray(body.targetRoles) ? body.targetRoles : [];
      const locations = Array.isArray(body.locations) ? body.locations : [];
      const workModes = Array.isArray(body.workModes) ? body.workModes : [];
      const autoApply = body.autoApply === true;
      await env.DB.prepare(
        `INSERT INTO preferences
         (user_id, target_roles_json, locations_json, work_modes_json, match_threshold, daily_limit, auto_apply, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           target_roles_json = excluded.target_roles_json,
           locations_json = excluded.locations_json,
           work_modes_json = excluded.work_modes_json,
           match_threshold = excluded.match_threshold,
           daily_limit = excluded.daily_limit,
           auto_apply = excluded.auto_apply,
           updated_at = excluded.updated_at`,
      ).bind(user.id, JSON.stringify(targetRoles), JSON.stringify(locations), JSON.stringify(workModes), threshold, dailyLimit, autoApply ? 1 : 0, now).run();
      return json({ saved: true, matchThreshold: threshold, dailyLimit, autoApply });
    }

    if (url.pathname === "/api/rolesignal/execution/settings" && request.method === "POST") {
      const body = await request.json() as Record<string, unknown>;
      const settings = clampExecutionSettings(body);
      await env.DB.prepare(
        `INSERT INTO execution_settings
         (user_id, enabled, min_score, daily_limit, mode, require_tailored_resume, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           enabled = excluded.enabled,
           min_score = excluded.min_score,
           daily_limit = excluded.daily_limit,
           mode = excluded.mode,
           require_tailored_resume = excluded.require_tailored_resume,
           updated_at = excluded.updated_at`,
      ).bind(
        user.id, settings.enabled ? 1 : 0, settings.minScore, settings.dailyLimit,
        settings.mode, settings.requireTailoredResume ? 1 : 0, now,
      ).run();
      const saved = await env.DB.prepare("SELECT * FROM execution_settings WHERE user_id = ?").bind(user.id).first<Record<string, unknown>>();
      return json({ saved: true, settings: rowToExecutionSettings(saved) });
    }

    if (url.pathname === "/api/rolesignal/execution/pair" && request.method === "POST") {
      const body = await request.json() as Record<string, unknown>;
      const name = asString(body.name, "Chrome on this computer").slice(0, 100);
      const token = newCompanionToken();
      const id = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO companion_devices (id, user_id, name, token_hash, status, last_seen_at, created_at)
         VALUES (?, ?, ?, ?, 'ACTIVE', NULL, ?)`,
      ).bind(id, user.id, name, await sha256(token), now).run();
      return json({ paired: true, connectionKey: token, device: { id, name, status: "ACTIVE", lastSeenAt: null, createdAt: now } }, 201);
    }

    if (url.pathname === "/api/rolesignal/execution/revoke-device" && request.method === "POST") {
      const body = await request.json() as Record<string, unknown>;
      const deviceId = asString(body.deviceId);
      const result = await env.DB.prepare("UPDATE companion_devices SET status = 'REVOKED' WHERE id = ? AND user_id = ?").bind(deviceId, user.id).run();
      if (!result.meta.changes) return json({ error: "Companion device not found." }, 404);
      await env.DB.prepare("UPDATE application_executions SET status = 'QUEUED', device_id = NULL, claimed_at = NULL, updated_at = ? WHERE user_id = ? AND device_id = ? AND status = 'CLAIMED'").bind(now, user.id, deviceId).run();
      return json({ revoked: true });
    }

    if (url.pathname === "/api/rolesignal/execution/queue-qualified" && request.method === "POST") {
      return json(await queueQualifiedExecutions(env, user, now), 201);
    }

    if (url.pathname === "/api/rolesignal/execution/queue" && request.method === "POST") {
      const body = await request.json() as Record<string, unknown>;
      const jobId = asString(body.jobId);
      const settingsRow = await env.DB.prepare("SELECT * FROM execution_settings WHERE user_id = ?").bind(user.id).first<Record<string, unknown>>();
      const settings = rowToExecutionSettings(settingsRow);
      if (!settings.enabled) return json({ error: "Enable guarded browser fill before adding an application." }, 409);
      const job = await env.DB.prepare("SELECT * FROM job_matches WHERE id = ? AND user_id = ?").bind(jobId, user.id).first<Record<string, unknown>>();
      if (!job) return json({ error: "Job not found." }, 404);
      return json(await queueExecutionForJob(env, user, job, settings, now), 201);
    }

    if (url.pathname === "/api/rolesignal/execution/retry" && request.method === "POST") {
      const body = await request.json() as Record<string, unknown>;
      const executionId = asString(body.executionId);
      const row = await env.DB.prepare(
        `SELECT j.* FROM application_executions e JOIN job_matches j ON j.id = e.job_id
         WHERE e.id = ? AND e.user_id = ?`,
      ).bind(executionId, user.id).first<Record<string, unknown>>();
      if (!row) return json({ error: "Application execution not found." }, 404);
      const settingsRow = await env.DB.prepare("SELECT * FROM execution_settings WHERE user_id = ?").bind(user.id).first<Record<string, unknown>>();
      return json(await queueExecutionForJob(env, user, row, rowToExecutionSettings(settingsRow), now));
    }

    if (url.pathname === "/api/rolesignal/automation/settings" && request.method === "POST") {
      const body = await request.json() as Record<string, unknown>;
      const enabled = body.enabled === true;
      const cadenceHours = Math.max(6, Math.min(168, Number(body.cadenceHours ?? 24)));
      const minScore = Math.max(75, Math.min(95, Number(body.minScore ?? 82)));
      const browserAlerts = body.browserAlerts !== false;
      const existingSearch = await env.DB.prepare(
        "SELECT id FROM discovery_searches WHERE user_id = ? AND active = 1 ORDER BY updated_at DESC LIMIT 1",
      ).bind(user.id).first<Record<string, unknown>>();
      if (!existingSearch) await upsertDiscoverySearch(env, user.id, discoveryConfig({ minScore }), now);
      const nextRunAt = addHours(now, cadenceHours);
      await env.DB.prepare(
        `INSERT INTO automation_settings
         (user_id, enabled, cadence_hours, min_score, browser_alerts, last_run_at, next_run_at, last_status, last_error, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, 'READY', NULL, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           enabled = excluded.enabled,
           cadence_hours = excluded.cadence_hours,
           min_score = excluded.min_score,
           browser_alerts = excluded.browser_alerts,
           next_run_at = CASE
             WHEN automation_settings.enabled = 1 AND excluded.enabled = 1 THEN automation_settings.next_run_at
             ELSE excluded.next_run_at
           END,
           last_status = CASE WHEN excluded.enabled = 1 THEN 'READY' ELSE 'PAUSED' END,
           last_error = NULL,
           updated_at = excluded.updated_at`,
      ).bind(user.id, enabled ? 1 : 0, cadenceHours, minScore, browserAlerts ? 1 : 0, nextRunAt, now).run();
      const saved = await env.DB.prepare("SELECT * FROM automation_settings WHERE user_id = ?").bind(user.id).first<Record<string, unknown>>();
      return json({ saved: true, automation: rowToAutomation(saved) });
    }

    if (url.pathname === "/api/rolesignal/automation/run-now" && request.method === "POST") {
      const existing = await env.DB.prepare("SELECT * FROM automation_settings WHERE user_id = ?").bind(user.id).first<Record<string, unknown>>();
      if (!existing) {
        await env.DB.prepare(
          `INSERT INTO automation_settings
           (user_id, enabled, cadence_hours, min_score, browser_alerts, last_run_at, next_run_at, last_status, last_error, updated_at)
           VALUES (?, 0, 24, 82, 1, NULL, ?, 'READY', NULL, ?)`,
        ).bind(user.id, addHours(now, 24), now).run();
      }
      const run = await runAutomationForUser(env, user, now);
      const automation = await env.DB.prepare("SELECT * FROM automation_settings WHERE user_id = ?").bind(user.id).first<Record<string, unknown>>();
      return json({ run, automation: rowToAutomation(automation) }, 201);
    }

    if (url.pathname === "/api/rolesignal/alerts/read" && request.method === "POST") {
      const body = await request.json() as Record<string, unknown>;
      const alertId = asString(body.alertId);
      if (alertId) {
        await env.DB.prepare("UPDATE job_alerts SET status = 'READ', read_at = ? WHERE id = ? AND user_id = ?").bind(now, alertId, user.id).run();
      } else {
        await env.DB.prepare("UPDATE job_alerts SET status = 'READ', read_at = ? WHERE user_id = ? AND status = 'UNREAD'").bind(now, user.id).run();
      }
      const alerts = await env.DB.prepare("SELECT * FROM job_alerts WHERE user_id = ? ORDER BY created_at DESC LIMIT 50").bind(user.id).all<Record<string, unknown>>();
      return json({ alerts: alerts.results.map(rowToAlert) });
    }

    if (url.pathname === "/api/rolesignal/answers" && request.method === "POST") {
      const body = await request.json() as Record<string, unknown>;
      const values = typeof body.values === "object" && body.values ? body.values as Record<string, unknown> : {};
      const statements: ReturnType<D1Database["prepare"]>[] = [];
      for (const [fieldKey, definition] of Object.entries(answerDefinitions)) {
        if (!(fieldKey in values)) continue;
        const value = asString(values[fieldKey]).slice(0, 500);
        if (!value) {
          statements.push(env.DB.prepare("DELETE FROM answer_vault WHERE user_id = ? AND field_key = ?").bind(user.id, fieldKey));
          continue;
        }
        statements.push(env.DB.prepare(
          `INSERT INTO answer_vault (id, user_id, field_key, label, value, status, sensitive, updated_at)
           VALUES (?, ?, ?, ?, ?, 'VERIFIED', ?, ?)
           ON CONFLICT(user_id, field_key) DO UPDATE SET
             label = excluded.label,
             value = excluded.value,
             status = 'VERIFIED',
             sensitive = excluded.sensitive,
             updated_at = excluded.updated_at`,
        ).bind(crypto.randomUUID(), user.id, fieldKey, definition.label, value, definition.sensitive ? 1 : 0, now));
      }
      if (!statements.length) return json({ error: "No recognized answer fields were provided." }, 400);
      await env.DB.batch(statements);
      return json({ saved: true, answerVault: (await answersForUser(env, user.id)).rows });
    }

    if (url.pathname === "/api/rolesignal/jobs/import" && request.method === "POST") {
      const body = await request.json() as Record<string, unknown>;
      return json({ job: await importSingleJob(body, env, user, now) }, 201);
    }

    if (url.pathname === "/api/rolesignal/jobs/enrich" && request.method === "POST") {
      const body = await request.json() as Record<string, unknown>;
      const jobId = asString(body.jobId);
      if (!jobId) return json({ error: "Job id is required." }, 400);
      return json({ job: await enrichSavedJob(env, user, jobId, now) });
    }

    if (url.pathname === "/api/rolesignal/discovery/run" && request.method === "POST") {
      const body = await request.json() as Record<string, unknown>;
      return json({ run: await runDiscovery(body, env, user, now) }, 201);
    }

    if (url.pathname === "/api/rolesignal/discovery/alerts" && request.method === "POST") {
      const body = await request.json() as Record<string, unknown>;
      return json(await importPortalAlert(body, env, user, now), 201);
    }

    if (url.pathname === "/api/rolesignal/discovery/capture" && request.method === "POST") {
      const body = await request.json() as Record<string, unknown>;
      return json({ run: await importPortalCapture(body, env, user, now) }, 201);
    }

    if (url.pathname === "/api/rolesignal/sources/scan" && request.method === "POST") {
      const body = await request.json() as Record<string, unknown>;
      return json({ report: await scanSource(body, env, user, now) }, 201);
    }

    if (url.pathname === "/api/rolesignal/sources/scan-all" && request.method === "POST") {
      return json({ run: await scanAllSources(env, user, now) }, 201);
    }

    if (url.pathname === "/api/rolesignal/sources/remove" && request.method === "POST") {
      const body = await request.json() as Record<string, unknown>;
      const sourceId = asString(body.sourceId);
      if (!sourceId) return json({ error: "Source id is required." }, 400);
      const result = await env.DB.prepare(
        "UPDATE job_sources SET active = 0 WHERE id = ? AND user_id = ?",
      ).bind(sourceId, user.id).run();
      if (!result.meta.changes) return json({ error: "Job source not found." }, 404);
      return json({ removed: true, sourceId });
    }

    if (url.pathname === "/api/rolesignal/applications/prepare" && request.method === "POST") {
      const body = await request.json() as Record<string, unknown>;
      return json({ packet: await prepareApplication(body, env, user, now) }, 201);
    }

    if (url.pathname === "/api/rolesignal/applications/resolve" && request.method === "POST") {
      const body = await request.json() as Record<string, unknown>;
      const packetId = asString(body.packetId);
      const provided = typeof body.answers === "object" && body.answers ? body.answers as Record<string, unknown> : {};
      const packet = await env.DB.prepare("SELECT * FROM application_packets WHERE id = ? AND user_id = ?").bind(packetId, user.id).first<Record<string, unknown>>();
      if (!packet) return json({ error: "Application packet not found." }, 404);
      await assertCurrentEvidence(env, user.id, packet.profile_version_id);
      const blockers = parseJson<Array<{ id: string; question: string; status: string }>>(packet.blockers_json, []);
      const answers = { ...parseJson<Record<string, unknown>>(packet.answers_json, {}), ...provided };
      const unresolved = blockers.filter((blocker) => !asString(provided[blocker.id]));
      const status = unresolved.length ? "NEEDS_INPUT" : "READY_FOR_REVIEW";
      await env.DB.batch([
        env.DB.prepare("UPDATE application_packets SET status = ?, answers_json = ?, blockers_json = ?, updated_at = ? WHERE id = ? AND user_id = ?")
          .bind(status, JSON.stringify(answers), JSON.stringify(unresolved), now, packetId, user.id),
        env.DB.prepare("INSERT INTO application_events (id, packet_id, user_id, event_type, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(crypto.randomUUID(), packetId, user.id, "INPUT_RESOLVED", JSON.stringify({ remaining: unresolved.length }), now),
      ]);
      return json({ saved: true, status, blockers: unresolved });
    }

    if (url.pathname === "/api/rolesignal/applications/approve" && request.method === "POST") {
      const body = await request.json() as Record<string, unknown>;
      const packetId = asString(body.packetId);
      const packet = await env.DB.prepare("SELECT * FROM application_packets WHERE id = ? AND user_id = ?").bind(packetId, user.id).first<Record<string, unknown>>();
      if (!packet) return json({ error: "Application packet not found." }, 404);
      await assertCurrentEvidence(env, user.id, packet.profile_version_id);
      const blockers = parseJson<unknown[]>(packet.blockers_json, []);
      if (blockers.length) return json({ error: "Resolve every required answer before approval.", blockers }, 409);
      await env.DB.batch([
        env.DB.prepare("UPDATE application_packets SET status = 'APPROVED_FOR_FILL', updated_at = ? WHERE id = ? AND user_id = ?").bind(now, packetId, user.id),
        env.DB.prepare("UPDATE application_kits SET status = 'APPROVED_FOR_FILL', updated_at = ? WHERE packet_id = ? AND user_id = ?").bind(now, packetId, user.id),
        env.DB.prepare("INSERT INTO application_events (id, packet_id, user_id, event_type, detail_json, created_at) VALUES (?, ?, ?, 'APPROVED_FOR_FILL', '{}', ?)").bind(crypto.randomUUID(), packetId, user.id, now),
      ]);
      return json({ approved: true, status: "APPROVED_FOR_FILL" });
    }

    if (url.pathname === "/api/rolesignal/applications/browser-packet" && request.method === "GET") {
      const packetId = url.searchParams.get("id") ?? "";
      const packet = await env.DB.prepare("SELECT * FROM application_packets WHERE id = ? AND user_id = ?").bind(packetId, user.id).first<Record<string, unknown>>();
      if (!packet) return json({ error: "Application packet not found." }, 404);
      await assertCurrentEvidence(env, user.id, packet.profile_version_id);
      const job = await env.DB.prepare("SELECT * FROM job_matches WHERE id = ? AND user_id = ?").bind(packet.job_id, user.id).first<Record<string, unknown>>();
      if (!job) return json({ error: "Job not found." }, 404);
      const vault = await answersForUser(env, user.id);
      const hydratedPacket = {
        ...packet,
        answers_json: JSON.stringify({ ...parseJson(packet.answers_json, {}), ...vault.values }),
      };
      return json({ packet: buildBrowserPacket(await profileForUser(env, user), job, hydratedPacket) });
    }

    if (url.pathname === "/api/rolesignal/applications/kit" && request.method === "GET") {
      const packetId = url.searchParams.get("id") ?? "";
      const kit = await env.DB.prepare(
        `SELECT k.*, j.company, j.role, j.location, j.application_url, j.match_score
         FROM application_kits k JOIN job_matches j ON j.id = k.job_id
         WHERE k.packet_id = ? AND k.user_id = ?`,
      ).bind(packetId, user.id).first<Record<string, unknown>>();
      if (!kit) return json({ error: "Application kit not found." }, 404);
      await assertCurrentEvidence(env, user.id, kit.profile_version_id);
      return json({
        kit: {
          id: kit.id,
          company: kit.company,
          role: kit.role,
          location: kit.location,
          applicationUrl: kit.application_url,
          score: kit.match_score,
          summary: kit.summary,
          whyAnswer: kit.why_answer,
          resumeChanges: parseJson(kit.resume_changes_json, []),
          evidence: parseJson(kit.evidence_json, []),
          formAnswers: parseJson(kit.form_answers_json, {}),
          status: kit.status,
        },
      });
    }

    if (url.pathname === "/api/rolesignal/studio/generate" && request.method === "POST") {
      const body = await request.json() as Record<string, unknown>;
      const jobId = asString(body.jobId);
      const jobRow = await env.DB.prepare(
        "SELECT * FROM job_matches WHERE id = ? AND user_id = ?",
      ).bind(jobId, user.id).first<Record<string, unknown>>();
      if (!jobRow) return json({ error: "Choose a live matched job before creating a tailored version." }, 404);
      await assertCurrentEvidence(env, user.id, jobRow.profile_version_id);
      if (Number(jobRow.match_score) < 75 || jobRow.status === "SKIPPED") return json({ error: "Only qualified jobs can enter the Tailored Studio." }, 409);
      const sources = await studioSources(env, user);
      const job = studioJobFromRow(jobRow);
      const scored = parseJson<Partial<ScoredJob>>(jobRow.score_json, {});
      const generated = buildStudioContent(sources.profile, sources.rawText, job, scored, sources.vault);
      const versionRow = await env.DB.prepare(
        "SELECT COALESCE(MAX(version), 0) AS latest_version FROM tailored_documents WHERE user_id = ? AND job_id = ?",
      ).bind(user.id, jobId).first<Record<string, unknown>>();
      const version = Number(versionRow?.latest_version ?? 0) + 1;
      const id = crypto.randomUUID();
      const title = `${job.company} - ${job.role}`.slice(0, 300);
      await env.DB.prepare(
        `INSERT INTO tailored_documents
         (id, user_id, job_id, resume_id, profile_version_id, version, status, title, content_json, evidence_json,
           grounding_score, docx_object_key, pdf_object_key, created_at, updated_at, approved_at)
         VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, NULL, NULL, ?, ?, NULL)`,
      ).bind(
        id, user.id, jobId, sources.resumeId || null, sources.profileVersionId, version, title,
        JSON.stringify(generated.content), JSON.stringify(generated.evidence), generated.groundingScore, now, now,
      ).run();
      const saved = await env.DB.prepare(
        `SELECT d.*, j.company, j.role, j.location, j.match_score
         FROM tailored_documents d JOIN job_matches j ON j.id = d.job_id
         WHERE d.id = ? AND d.user_id = ?`,
      ).bind(id, user.id).first<Record<string, unknown>>();
      return json({ document: saved ? rowToStudioDocument(saved) : null }, 201);
    }

    if (url.pathname === "/api/rolesignal/studio/documents" && request.method === "PATCH") {
      const body = await request.json() as Record<string, unknown>;
      const id = asString(body.id);
      const row = await env.DB.prepare(
        `SELECT d.*, j.company, j.role, j.location, j.description, j.application_url, j.match_score
         FROM tailored_documents d JOIN job_matches j ON j.id = d.job_id
         WHERE d.id = ? AND d.user_id = ?`,
      ).bind(id, user.id).first<Record<string, unknown>>();
      if (!row) return json({ error: "Tailored document not found." }, 404);
      await assertCurrentEvidence(env, user.id, row.profile_version_id);
      const content = safeStudioContent(body.content);
      if (!content.summary || !content.sections.length || !content.skills.length) return json({ error: "Keep a summary, skills, and at least one evidence section before saving." }, 400);
      const sources = await studioSources(env, user);
      const job = studioJobFromRow(row);
      const previous = parseJson<EvidenceBinding[]>(row.evidence_json, []);
      const validation = validateStudioContent(content, previous, sources.profile, sources.rawText, job, sources.vault);
      await env.DB.prepare(
        `UPDATE tailored_documents SET content_json = ?, evidence_json = ?, grounding_score = ?, status = 'DRAFT',
         docx_object_key = NULL, pdf_object_key = NULL, approved_at = NULL, updated_at = ?
         WHERE id = ? AND user_id = ?`,
      ).bind(JSON.stringify(content), JSON.stringify(validation.evidence), validation.groundingScore, now, id, user.id).run();
      const saved = await env.DB.prepare(
        `SELECT d.*, j.company, j.role, j.location, j.match_score
         FROM tailored_documents d JOIN job_matches j ON j.id = d.job_id
         WHERE d.id = ? AND d.user_id = ?`,
      ).bind(id, user.id).first<Record<string, unknown>>();
      return json({ document: saved ? rowToStudioDocument(saved) : null });
    }

    if (url.pathname === "/api/rolesignal/studio/approve" && request.method === "POST") {
      const body = await request.json() as Record<string, unknown>;
      const id = asString(body.id);
      const row = await env.DB.prepare(
        `SELECT d.*, j.company, j.role, j.location, j.description, j.application_url, j.match_score
         FROM tailored_documents d JOIN job_matches j ON j.id = d.job_id
         WHERE d.id = ? AND d.user_id = ?`,
      ).bind(id, user.id).first<Record<string, unknown>>();
      if (!row) return json({ error: "Tailored document not found." }, 404);
      await assertCurrentEvidence(env, user.id, row.profile_version_id);
      const content = safeStudioContent(parseJson(row.content_json, {}));
      const sources = await studioSources(env, user);
      const job = studioJobFromRow(row);
      const validation = validateStudioContent(content, parseJson(row.evidence_json, []), sources.profile, sources.rawText, job, sources.vault);
      const unsupported = validation.evidence.filter((binding) => binding.status !== "VERIFIED");
      if (unsupported.length) {
        await env.DB.prepare(
          "UPDATE tailored_documents SET evidence_json = ?, grounding_score = ?, status = 'DRAFT', updated_at = ? WHERE id = ? AND user_id = ?",
        ).bind(JSON.stringify(validation.evidence), validation.groundingScore, now, id, user.id).run();
        return json({ error: `${unsupported.length} edited claim${unsupported.length === 1 ? " needs" : "s need"} source evidence before approval.`, groundingScore: validation.groundingScore, unsupported }, 409);
      }
      const version = Number(row.version);
      const baseKey = `studio/${user.id}/${id}/v${version}`;
      const docxKey = `${baseKey}.docx`;
      const pdfKey = `${baseKey}.pdf`;
      const docx = buildResumeDocx(content, job, now);
      const pdf = buildResumePdf(content, job);
      await Promise.all([
        env.RESUMES.put(docxKey, docx, {
          httpMetadata: { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
          customMetadata: { owner: user.id, jobId: job.id, documentId: id, version: String(version) },
        }),
        env.RESUMES.put(pdfKey, pdf, {
          httpMetadata: { contentType: "application/pdf" },
          customMetadata: { owner: user.id, jobId: job.id, documentId: id, version: String(version) },
        }),
      ]);
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE tailored_documents SET status = 'SUPERSEDED', updated_at = ? WHERE user_id = ? AND job_id = ? AND status = 'APPROVED' AND id != ?",
        ).bind(now, user.id, row.job_id, id),
        env.DB.prepare(
          `UPDATE tailored_documents SET status = 'APPROVED', evidence_json = ?, grounding_score = 100,
           docx_object_key = ?, pdf_object_key = ?, approved_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
        ).bind(JSON.stringify(validation.evidence), docxKey, pdfKey, now, now, id, user.id),
      ]);
      const saved = await env.DB.prepare(
        `SELECT d.*, j.company, j.role, j.location, j.match_score
         FROM tailored_documents d JOIN job_matches j ON j.id = d.job_id
         WHERE d.id = ? AND d.user_id = ?`,
      ).bind(id, user.id).first<Record<string, unknown>>();
      return json({ approved: true, document: saved ? rowToStudioDocument(saved) : null });
    }

    if (url.pathname === "/api/rolesignal/studio/download" && request.method === "GET") {
      const id = url.searchParams.get("id") ?? "";
      const format = url.searchParams.get("format") === "pdf" ? "pdf" : "docx";
      const row = await env.DB.prepare(
        `SELECT d.*, j.company, j.role FROM tailored_documents d JOIN job_matches j ON j.id = d.job_id
         WHERE d.id = ? AND d.user_id = ?`,
      ).bind(id, user.id).first<Record<string, unknown>>();
      if (!row) return json({ error: "Tailored document not found." }, 404);
      if (row.status !== "APPROVED" && row.status !== "SUPERSEDED") return json({ error: "Approve this evidence-grounded version before downloading it." }, 409);
      const objectKey = asString(format === "pdf" ? row.pdf_object_key : row.docx_object_key);
      if (!objectKey) return json({ error: "This document format has not been generated yet." }, 404);
      const object = await env.RESUMES.get(objectKey);
      if (!object) return json({ error: "The generated file is no longer available." }, 404);
      const safeBase = `${asString(row.company)}-${asString(row.role)}-v${Number(row.version)}`.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 140);
      const headers = new Headers({
        "content-type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "content-disposition": `attachment; filename="${safeBase}.${format}"`,
        "cache-control": "private, no-store",
      });
      object.writeHttpMetadata(headers);
      headers.set("etag", object.httpEtag);
      return new Response(object.body, { headers });
    }

    if (url.pathname === "/api/rolesignal/export/ledger.csv" && request.method === "GET") {
      const result = await env.DB.prepare(
        `SELECT j.match_score, j.company, j.role, j.location, j.posted_date, j.platform,
                CASE WHEN p.status IS NULL THEN j.status ELSE p.status END AS ledger_status,
                j.application_url
         FROM job_matches j
         LEFT JOIN application_packets p ON p.user_id = j.user_id AND p.job_id = j.id
         WHERE j.user_id = ?
         ORDER BY j.match_score DESC, j.updated_at DESC`,
      ).bind(user.id).all<Record<string, unknown>>();
      const header = ["Score", "Company", "Role", "Location", "Posted", "Platform", "Status", "URL"];
      const rows = result.results.map((row) => [
        row.match_score, row.company, row.role, row.location, row.posted_date,
        row.platform, row.ledger_status, row.application_url,
      ]);
      const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
      return new Response(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="rolesignal-ledger-${now.slice(0, 10)}.csv"`,
          "cache-control": "no-store",
        },
      });
    }

    if (url.pathname === "/api/rolesignal/export/run.md" && request.method === "GET") {
      const runId = url.searchParams.get("id") ?? "";
      const row = await env.DB.prepare("SELECT * FROM search_runs WHERE id = ? AND user_id = ?").bind(runId, user.id).first<Record<string, unknown>>();
      if (!row) return json({ error: "Search run not found." }, 404);
      const run = rowToRun(row);
      const report = run.report as { topOpportunities?: Array<Record<string, unknown>>; highestPriority?: Array<Record<string, unknown>>; failures?: Array<Record<string, unknown>>; autoStaged?: Array<Record<string, unknown>> };
      const jobLines = (jobs: Array<Record<string, unknown>> = []) => jobs.map((job, index) => `${index + 1}. **${job.company} — ${job.role}** (${job.score}/100)\n   ${job.location} · ${job.platform} · ${job.applicationUrl}`).join("\n");
      const markdown = [
        "# RoleSignal Search Run",
        `Completed: ${run.completedAt ?? run.startedAt}`,
        "",
        "## Application Summary",
        `- Jobs discovered: ${run.jobsDiscovered}`,
        `- Unique jobs: ${run.uniqueJobs}`,
        `- Jobs analyzed: ${run.analyzed}`,
        `- Exceptional matches: ${run.exceptional}`,
        `- Strong matches: ${run.strong}`,
        `- Ready to review: ${run.ready}`,
        `- Needs input: ${run.needsInput}`,
        `- Skipped: ${run.skipped}`,
        `- Application kits auto-staged: ${report.autoStaged?.length ?? 0}`,
        "",
        "## Highest Priority",
        jobLines(report.highestPriority),
        "",
        "## Top Opportunities",
        jobLines(report.topOpportunities),
        "",
        report.failures?.length ? `## Source Issues\n${report.failures.map((failure) => `- ${failure.source}: ${failure.message}`).join("\n")}` : "",
      ].filter(Boolean).join("\n");
      return new Response(markdown, {
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "content-disposition": `attachment; filename="rolesignal-run-${runId.slice(0, 8)}.md"`,
          "cache-control": "no-store",
        },
      });
    }

    if (url.pathname === "/api/rolesignal/export/discovery-run.md" && request.method === "GET") {
      const runId = url.searchParams.get("id") ?? "";
      const row = await env.DB.prepare("SELECT * FROM discovery_runs WHERE id = ? AND user_id = ?").bind(runId, user.id).first<Record<string, unknown>>();
      if (!row) return json({ error: "Discovery run not found." }, 404);
      const run = rowToDiscoveryRun(row);
      const report = run.report as { topOpportunities?: Array<Record<string, unknown>>; highestPriority?: Array<Record<string, unknown>>; failures?: Array<Record<string, unknown>>; portal?: string; sourceUrl?: string; autoStaged?: Array<Record<string, unknown>> };
      const jobLines = (jobs: Array<Record<string, unknown>> = []) => jobs.map((job, index) => `${index + 1}. **${job.company} — ${job.role}** (${job.score}/100)\n   ${job.location} · ${job.platform} · ${job.applicationUrl}`).join("\n");
      const markdown = [
        "# RoleSignal Discovery Run",
        `Mode: ${run.mode}`,
        `Completed: ${run.completedAt ?? run.startedAt}`,
        report.portal ? `Portal: ${report.portal}` : "",
        report.sourceUrl ? `Source page: ${report.sourceUrl}` : "",
        "",
        "## Summary",
        `- Jobs discovered: ${run.discovered}`,
        `- New jobs imported: ${run.imported}`,
        `- Duplicates merged: ${run.duplicates}`,
        `- Qualified matches: ${run.qualified}`,
        `- Application kits auto-staged: ${report.autoStaged?.length ?? 0}`,
        "",
        "## Highest Priority",
        jobLines(report.highestPriority),
        "",
        "## Top Opportunities",
        jobLines(report.topOpportunities),
        "",
        report.failures?.length ? `## Provider Issues\n${report.failures.map((failure) => `- ${failure.provider}: ${failure.message}`).join("\n")}` : "",
      ].filter(Boolean).join("\n");
      return new Response(markdown, {
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "content-disposition": `attachment; filename="rolesignal-discovery-${runId.slice(0, 8)}.md"`,
          "cache-control": "no-store",
        },
      });
    }

    return json({ error: "Not found" }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The request could not be completed.";
    return json({ error: message }, 400);
  }
}

export default worker;
