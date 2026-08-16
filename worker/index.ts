/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  RESUMES: R2Bucket;
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

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/rolesignal/")) {
      return handleRoleSignalApi(request, env, url);
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
  `CREATE INDEX IF NOT EXISTS idx_resumes_user_id ON resumes(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_match_score ON jobs(match_score DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_applications_user_status ON applications(user_id, status)`,
] as const;

async function ensureSchema(env: Env) {
  await env.DB.batch(schemaStatements.map((sql) => env.DB.prepare(sql)));
  await env.DB.prepare("PRAGMA optimize").run();
}

function currentUser(request: Request) {
  return {
    id: request.headers.get("oai-authenticated-user-id") ?? "local-preview-user",
    email: request.headers.get("oai-authenticated-user-email") ?? "",
    name: request.headers.get("oai-authenticated-user-full-name") ?? "Rohit Kumar",
  };
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

async function handleRoleSignalApi(request: Request, env: Env, url: URL) {
  await ensureSchema(env);
  const user = currentUser(request);
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO users (user_id, email, display_name, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, display_name = excluded.display_name`,
  ).bind(user.id, user.email, user.name, now).run();

  if (url.pathname === "/api/rolesignal/workspace" && request.method === "GET") {
    const resumes = await env.DB.prepare(
      `SELECT id, filename, content_type, size_bytes, status, created_at
       FROM resumes WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`,
    ).bind(user.id).all();
    const preferences = await env.DB.prepare(
      "SELECT * FROM preferences WHERE user_id = ?",
    ).bind(user.id).first();
    return json({ user, resumes: resumes.results, preferences });
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

    const id = crypto.randomUUID();
    const safeName = candidateFile.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const objectKey = `${user.id}/${id}-${safeName}`;
    await env.RESUMES.put(objectKey, candidateFile.stream(), {
      httpMetadata: { contentType: candidateFile.type },
      customMetadata: { owner: user.id, originalName: candidateFile.name },
    });
    await env.DB.prepare(
      `INSERT INTO resumes
       (id, user_id, object_key, filename, content_type, size_bytes, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, user.id, objectKey, candidateFile.name, candidateFile.type, candidateFile.size, "uploaded", now).run();
    return json({ id, filename: candidateFile.name, size: candidateFile.size, status: "uploaded" }, 201);
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
    ).bind(
      user.id,
      JSON.stringify(targetRoles),
      JSON.stringify(locations),
      JSON.stringify(workModes),
      threshold,
      dailyLimit,
      autoApply ? 1 : 0,
      now,
    ).run();
    return json({ saved: true, matchThreshold: threshold, dailyLimit, autoApply });
  }

  return json({ error: "Not found" }, 404);
}

export default worker;
