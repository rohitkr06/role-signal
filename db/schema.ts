import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  userId: text("user_id").primaryKey(),
  email: text("email"),
  displayName: text("display_name"),
  createdAt: text("created_at").notNull(),
});

export const resumes = sqliteTable("resumes", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  objectKey: text("object_key").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_resumes_user_id").on(table.userId)]);

export const preferences = sqliteTable("preferences", {
  userId: text("user_id").primaryKey(),
  targetRolesJson: text("target_roles_json").notNull(),
  locationsJson: text("locations_json").notNull(),
  workModesJson: text("work_modes_json").notNull(),
  matchThreshold: integer("match_threshold").notNull(),
  dailyLimit: integer("daily_limit").notNull(),
  autoApply: integer("auto_apply", { mode: "boolean" }).notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  company: text("company").notNull(),
  role: text("role").notNull(),
  location: text("location").notNull(),
  workMode: text("work_mode").notNull(),
  platform: text("platform").notNull(),
  applicationUrl: text("application_url").notNull(),
  matchScore: integer("match_score").notNull(),
  classification: text("classification").notNull(),
  payloadJson: text("payload_json").notNull(),
  discoveredAt: text("discovered_at").notNull(),
}, (table) => [index("idx_jobs_match_score").on(table.matchScore)]);

export const applications = sqliteTable("applications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  jobId: text("job_id").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("idx_applications_user_status").on(table.userId, table.status)]);

export const careerProfiles = sqliteTable("career_profiles", {
  userId: text("user_id").primaryKey(),
  resumeId: text("resume_id"),
  rawText: text("raw_text").notNull(),
  extractedJson: text("extracted_json").notNull(),
  status: text("status").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const jobSources = sqliteTable("job_sources", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  provider: text("provider").notNull(),
  sourceToken: text("source_token").notNull(),
  label: text("label").notNull(),
  active: integer("active", { mode: "boolean" }).notNull(),
  lastScannedAt: text("last_scanned_at"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("idx_job_sources_user_provider_token").on(table.userId, table.provider, table.sourceToken),
]);

export const jobMatches = sqliteTable("job_matches", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  sourceId: text("source_id"),
  fingerprint: text("fingerprint").notNull(),
  company: text("company").notNull(),
  role: text("role").notNull(),
  location: text("location").notNull(),
  workMode: text("work_mode").notNull(),
  platform: text("platform").notNull(),
  applicationUrl: text("application_url").notNull(),
  postedDate: text("posted_date"),
  description: text("description").notNull(),
  compensation: text("compensation"),
  matchScore: integer("match_score").notNull(),
  classification: text("classification").notNull(),
  status: text("status").notNull(),
  scoreJson: text("score_json").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_job_matches_user_fingerprint").on(table.userId, table.fingerprint),
  index("idx_job_matches_user_score").on(table.userId, table.matchScore),
  index("idx_job_matches_user_status").on(table.userId, table.status),
]);

export const applicationPackets = sqliteTable("application_packets", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  jobId: text("job_id").notNull(),
  status: text("status").notNull(),
  answersJson: text("answers_json").notNull(),
  blockersJson: text("blockers_json").notNull(),
  resumeStrategyJson: text("resume_strategy_json").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_application_packets_user_job").on(table.userId, table.jobId),
  index("idx_application_packets_user_status").on(table.userId, table.status),
]);

export const applicationEvents = sqliteTable("application_events", {
  id: text("id").primaryKey(),
  packetId: text("packet_id").notNull(),
  userId: text("user_id").notNull(),
  eventType: text("event_type").notNull(),
  detailJson: text("detail_json").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_application_events_packet").on(table.packetId)]);

export const answerVault = sqliteTable("answer_vault", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  fieldKey: text("field_key").notNull(),
  label: text("label").notNull(),
  value: text("value").notNull(),
  status: text("status").notNull(),
  sensitive: integer("sensitive", { mode: "boolean" }).notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_answer_vault_user_field").on(table.userId, table.fieldKey),
]);

export const searchRuns = sqliteTable("search_runs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  status: text("status").notNull(),
  sourceCount: integer("source_count").notNull(),
  jobsDiscovered: integer("jobs_discovered").notNull(),
  uniqueJobs: integer("unique_jobs").notNull(),
  analyzed: integer("analyzed").notNull(),
  exceptional: integer("exceptional").notNull(),
  strong: integer("strong").notNull(),
  ready: integer("ready").notNull(),
  needsInput: integer("needs_input").notNull(),
  skipped: integer("skipped").notNull(),
  reportJson: text("report_json").notNull(),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
}, (table) => [
  index("idx_search_runs_user_completed").on(table.userId, table.completedAt),
]);

export const applicationKits = sqliteTable("application_kits", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  jobId: text("job_id").notNull(),
  packetId: text("packet_id").notNull(),
  summary: text("summary").notNull(),
  whyAnswer: text("why_answer").notNull(),
  resumeChangesJson: text("resume_changes_json").notNull(),
  evidenceJson: text("evidence_json").notNull(),
  formAnswersJson: text("form_answers_json").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_application_kits_user_job").on(table.userId, table.jobId),
  index("idx_application_kits_packet").on(table.packetId),
]);

export const discoverySearches = sqliteTable("discovery_searches", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  keywordsJson: text("keywords_json").notNull(),
  locationsJson: text("locations_json").notNull(),
  workModesJson: text("work_modes_json").notNull(),
  portalsJson: text("portals_json").notNull(),
  minScore: integer("min_score").notNull(),
  active: integer("active", { mode: "boolean" }).notNull(),
  lastRunAt: text("last_run_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_discovery_searches_user_name").on(table.userId, table.name),
  index("idx_discovery_searches_user_updated").on(table.userId, table.updatedAt),
]);

export const discoveryRuns = sqliteTable("discovery_runs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  searchId: text("search_id"),
  mode: text("mode").notNull(),
  status: text("status").notNull(),
  providersJson: text("providers_json").notNull(),
  discovered: integer("discovered").notNull(),
  imported: integer("imported").notNull(),
  duplicates: integer("duplicates").notNull(),
  qualified: integer("qualified").notNull(),
  reportJson: text("report_json").notNull(),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
}, (table) => [
  index("idx_discovery_runs_user_completed").on(table.userId, table.completedAt),
  index("idx_discovery_runs_search").on(table.searchId),
]);

export const automationSettings = sqliteTable("automation_settings", {
  userId: text("user_id").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  cadenceHours: integer("cadence_hours").notNull(),
  minScore: integer("min_score").notNull(),
  browserAlerts: integer("browser_alerts", { mode: "boolean" }).notNull(),
  lastRunAt: text("last_run_at"),
  nextRunAt: text("next_run_at").notNull(),
  lastStatus: text("last_status").notNull(),
  lastError: text("last_error"),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("idx_automation_settings_due").on(table.enabled, table.nextRunAt),
]);

export const jobAlerts = sqliteTable("job_alerts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  jobId: text("job_id").notNull(),
  discoveryRunId: text("discovery_run_id"),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  detailJson: text("detail_json").notNull(),
  createdAt: text("created_at").notNull(),
  readAt: text("read_at"),
}, (table) => [
  uniqueIndex("idx_job_alerts_user_job_kind").on(table.userId, table.jobId, table.kind),
  index("idx_job_alerts_user_status_created").on(table.userId, table.status, table.createdAt),
]);
