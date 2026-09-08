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
