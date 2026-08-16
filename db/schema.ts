import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
