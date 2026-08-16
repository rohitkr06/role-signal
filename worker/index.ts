/** RoleSignal Cloudflare Worker entry point. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  ROHIT_PROFILE,
  inferPlatform,
  inferWorkMode,
  profileFromResumeText,
  scoreJob,
  stripHtml,
  type CandidateProfile,
  type JobInput,
  type ScoredJob,
} from "../lib/rolesignal";

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
  `CREATE TABLE IF NOT EXISTS career_profiles (
    user_id TEXT PRIMARY KEY,
    resume_id TEXT,
    raw_text TEXT NOT NULL,
    extracted_json TEXT NOT NULL,
    status TEXT NOT NULL,
    updated_at TEXT NOT NULL
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
  `CREATE INDEX IF NOT EXISTS idx_resumes_user_id ON resumes(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_match_score ON jobs(match_score DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_applications_user_status ON applications(user_id, status)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_job_sources_user_provider_token ON job_sources(user_id, provider, source_token)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_job_matches_user_fingerprint ON job_matches(user_id, fingerprint)`,
  `CREATE INDEX IF NOT EXISTS idx_job_matches_user_score ON job_matches(user_id, match_score DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_job_matches_user_status ON job_matches(user_id, status)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_application_packets_user_job ON application_packets(user_id, job_id)`,
  `CREATE INDEX IF NOT EXISTS idx_application_packets_user_status ON application_packets(user_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_application_events_packet ON application_events(packet_id)`,
] as const;

async function ensureSchema(env: Env) {
  await env.DB.batch(schemaStatements.map((sql) => env.DB.prepare(sql)));
  await env.DB.prepare("PRAGMA optimize").run();
}

function currentUser(request: Request) {
  const encodedName = request.headers.get("oai-authenticated-user-full-name");
  const encoding = request.headers.get("oai-authenticated-user-full-name-encoding");
  let name = "Rohit Kumar";
  if (encodedName) {
    try { name = encoding === "percent-encoded-utf-8" ? decodeURIComponent(encodedName) : encodedName; } catch { name = encodedName; }
  }
  return {
    id: request.headers.get("oai-authenticated-user-id") ?? "local-preview-user",
    email: request.headers.get("oai-authenticated-user-email") ?? "",
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
  return {
    id: row.id,
    jobId: row.job_id,
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
}

async function profileForUser(env: Env, user: { id: string; email: string; name: string }) {
  const row = await env.DB.prepare(
    "SELECT extracted_json FROM career_profiles WHERE user_id = ?",
  ).bind(user.id).first<Record<string, unknown>>();
  if (!row?.extracted_json) return { ...ROHIT_PROFILE, name: user.name, email: user.email };
  const parsed = parseJson<CandidateProfile>(row.extracted_json, ROHIT_PROFILE);
  return {
    ...ROHIT_PROFILE,
    ...parsed,
    name: parsed.name || user.name,
    email: parsed.email || user.email,
    experienceYears: parsed.experienceYears || ROHIT_PROFILE.experienceYears,
    skills: [...new Set([...ROHIT_PROFILE.skills, ...(parsed.skills ?? [])])],
    domains: [...new Set([...ROHIT_PROFILE.domains, ...(parsed.domains ?? [])])],
    evidence: [...new Set([...(parsed.evidence ?? []), ...ROHIT_PROFILE.evidence])].slice(0, 12),
  } satisfies CandidateProfile;
}

async function saveScoredJob(env: Env, userId: string, scored: ScoredJob, sourceId: string | null, now: string) {
  const existing = await env.DB.prepare(
    "SELECT id, platform, application_url FROM job_matches WHERE user_id = ? AND fingerprint = ?",
  ).bind(userId, scored.fingerprint).first<Record<string, unknown>>();
  const id = asString(existing?.id) || crypto.randomUUID();
  const officialPlatforms = new Set(["Company site", "Greenhouse", "Lever", "Ashby"]);
  const shouldPreferNewUrl = !existing || officialPlatforms.has(scored.platform ?? "");
  const applicationUrl = shouldPreferNewUrl ? scored.applicationUrl : asString(existing.application_url, scored.applicationUrl);
  await env.DB.prepare(
    `INSERT INTO job_matches
     (id, user_id, source_id, fingerprint, company, role, location, work_mode, platform,
      application_url, posted_date, description, compensation, match_score, classification,
      status, score_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, fingerprint) DO UPDATE SET
       source_id = excluded.source_id,
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
    id, userId, sourceId, scored.fingerprint, scored.company, scored.role, scored.location,
    scored.workMode ?? "Not specified", scored.platform ?? "Company site", applicationUrl,
    scored.postedDate ?? null, scored.description, scored.compensation ?? null, scored.score,
    scored.classification, scored.status, JSON.stringify({ ...scored, applicationUrl }), now, now,
  ).run();
  return { id, duplicate: Boolean(existing), applicationUrl };
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
    const response = await fetch(target, {
      headers: { accept, "user-agent": "RoleSignal/2.0 job-matching assistant" },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`The job source returned ${response.status}.`);
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > 3_000_000) throw new Error("The job page is too large to import safely.");
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

async function scanSource(
  body: Record<string, unknown>,
  env: Env,
  user: { id: string; email: string; name: string },
  now: string,
) {
  const provider = asString(body.provider).toLowerCase();
  const token = asString(body.token).toLowerCase();
  const label = asString(body.label, token.replace(/[-_]/g, " ").replace(/\b\w/g, (value) => value.toUpperCase()));
  if (!new Set(["greenhouse", "lever"]).has(provider)) throw new Error("Choose Greenhouse or Lever.");
  if (!/^[a-z0-9][a-z0-9_-]{1,79}$/.test(token)) throw new Error("Enter the company board token from its careers URL.");

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
  } else {
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
  }

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
      current_company: "SaaS Labs / JustCall",
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
  const jobId = asString(body.jobId);
  const job = await env.DB.prepare(
    "SELECT * FROM job_matches WHERE id = ? AND user_id = ?",
  ).bind(jobId, user.id).first<Record<string, unknown>>();
  if (!job) throw new Error("That job is no longer available in your workspace.");
  if (Number(job.match_score) < 75 || job.status === "SKIPPED") throw new Error("Only qualified jobs can enter the application queue.");
  const scored = parseJson<ScoredJob>(job.score_json, {} as ScoredJob);
  const questions = Array.isArray(body.requiredQuestions) ? body.requiredQuestions.map((item) => asString(item)).filter(Boolean) : [];
  const unknownPattern = /compensation|salary|ctc|notice period|authorization|visa|sponsor|relocat|demographic|gender|disability|veteran|legal|criminal/i;
  const blockers = questions.filter((question) => unknownPattern.test(question)).map((question) => ({
    id: crypto.randomUUID(), question, status: "NEEDS_INPUT",
  }));
  const profile = await profileForUser(env, user);
  const answers = {
    full_name: profile.name,
    email: profile.email,
    current_company: "SaaS Labs / JustCall",
    current_title: profile.title,
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
     (id, user_id, job_id, status, answers_json, blockers_json, resume_strategy_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, job_id) DO UPDATE SET
       status = excluded.status,
       answers_json = excluded.answers_json,
       blockers_json = excluded.blockers_json,
       resume_strategy_json = excluded.resume_strategy_json,
       updated_at = excluded.updated_at`,
  ).bind(packetId, user.id, jobId, status, JSON.stringify(answers), JSON.stringify(blockers), JSON.stringify(resumeStrategy), now, now).run();
  const saved = await env.DB.prepare(
    "SELECT * FROM application_packets WHERE user_id = ? AND job_id = ?",
  ).bind(user.id, jobId).first<Record<string, unknown>>();
  await env.DB.prepare(
    "INSERT INTO application_events (id, packet_id, user_id, event_type, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), saved?.id, user.id, "PREPARED", JSON.stringify({ score: job.match_score, blockers: blockers.length }), now).run();
  return { ...rowToPacket({ ...saved, company: job.company, role: job.role, application_url: job.application_url, match_score: job.match_score }), browserPacket: buildBrowserPacket(profile, job, saved ?? {}) };
}

async function handleRoleSignalApi(request: Request, env: Env, url: URL) {
  try {
    await ensureSchema(env);
    const user = currentUser(request);
    const now = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO users (user_id, email, display_name, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, display_name = excluded.display_name`,
    ).bind(user.id, user.email, user.name, now).run();

    if (url.pathname === "/api/rolesignal/workspace" && request.method === "GET") {
      const [resumes, preferences, profile, matches, sources, packets] = await Promise.all([
        env.DB.prepare(
          `SELECT id, filename, content_type, size_bytes, status, created_at
           FROM resumes WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`,
        ).bind(user.id).all(),
        env.DB.prepare("SELECT * FROM preferences WHERE user_id = ?").bind(user.id).first(),
        profileForUser(env, user),
        env.DB.prepare("SELECT * FROM job_matches WHERE user_id = ? ORDER BY match_score DESC, updated_at DESC LIMIT 200").bind(user.id).all(),
        env.DB.prepare("SELECT * FROM job_sources WHERE user_id = ? ORDER BY created_at DESC").bind(user.id).all(),
        env.DB.prepare(
          `SELECT p.*, j.company, j.role, j.application_url, j.match_score
           FROM application_packets p JOIN job_matches j ON j.id = p.job_id
           WHERE p.user_id = ? ORDER BY p.updated_at DESC`,
        ).bind(user.id).all(),
      ]);
      return json({
        user,
        resumes: resumes.results,
        preferences,
        profile,
        jobs: (matches.results as Record<string, unknown>[]).map(rowToJob),
        sources: sources.results,
        packets: (packets.results as Record<string, unknown>[]).map(rowToPacket),
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
      const profile = resumeText ? profileFromResumeText(resumeText.slice(0, 200_000), user.name, user.email) : null;
      const status = profile ? "analyzed" : "needs_text_extraction";
      await env.RESUMES.put(objectKey, bytes, {
        httpMetadata: { contentType: candidateFile.type },
        customMetadata: { owner: user.id, originalName: candidateFile.name },
      });
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO resumes
           (id, user_id, object_key, filename, content_type, size_bytes, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(id, user.id, objectKey, candidateFile.name, candidateFile.type, candidateFile.size, status, now),
        env.DB.prepare(
          `INSERT INTO career_profiles (user_id, resume_id, raw_text, extracted_json, status, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             resume_id = excluded.resume_id,
             raw_text = excluded.raw_text,
             extracted_json = excluded.extracted_json,
             status = excluded.status,
             updated_at = excluded.updated_at`,
        ).bind(user.id, id, resumeText, JSON.stringify(profile ?? { ...ROHIT_PROFILE, name: user.name, email: user.email }), status, now),
      ]);
      return json({ id, filename: candidateFile.name, size: candidateFile.size, status, profile }, 201);
    }

    if (url.pathname === "/api/rolesignal/profile/analyze" && request.method === "POST") {
      const body = await request.json() as Record<string, unknown>;
      const resumeText = asString(body.resumeText).slice(0, 200_000);
      if (resumeText.length < 80) return json({ error: "Paste enough resume text to analyze accurately." }, 400);
      const profile = profileFromResumeText(resumeText, user.name, user.email);
      await env.DB.prepare(
        `INSERT INTO career_profiles (user_id, resume_id, raw_text, extracted_json, status, updated_at)
         VALUES (?, NULL, ?, ?, 'analyzed', ?)
         ON CONFLICT(user_id) DO UPDATE SET
           raw_text = excluded.raw_text,
           extracted_json = excluded.extracted_json,
           status = excluded.status,
           updated_at = excluded.updated_at`,
      ).bind(user.id, resumeText, JSON.stringify(profile), now).run();
      return json({ profile: await profileForUser(env, user), status: "analyzed" });
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

    if (url.pathname === "/api/rolesignal/jobs/import" && request.method === "POST") {
      const body = await request.json() as Record<string, unknown>;
      return json({ job: await importSingleJob(body, env, user, now) }, 201);
    }

    if (url.pathname === "/api/rolesignal/sources/scan" && request.method === "POST") {
      const body = await request.json() as Record<string, unknown>;
      return json({ report: await scanSource(body, env, user, now) }, 201);
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
      const blockers = parseJson<unknown[]>(packet.blockers_json, []);
      if (blockers.length) return json({ error: "Resolve every required answer before approval.", blockers }, 409);
      await env.DB.batch([
        env.DB.prepare("UPDATE application_packets SET status = 'APPROVED_FOR_FILL', updated_at = ? WHERE id = ? AND user_id = ?").bind(now, packetId, user.id),
        env.DB.prepare("INSERT INTO application_events (id, packet_id, user_id, event_type, detail_json, created_at) VALUES (?, ?, ?, 'APPROVED_FOR_FILL', '{}', ?)").bind(crypto.randomUUID(), packetId, user.id, now),
      ]);
      return json({ approved: true, status: "APPROVED_FOR_FILL" });
    }

    if (url.pathname === "/api/rolesignal/applications/browser-packet" && request.method === "GET") {
      const packetId = url.searchParams.get("id") ?? "";
      const packet = await env.DB.prepare("SELECT * FROM application_packets WHERE id = ? AND user_id = ?").bind(packetId, user.id).first<Record<string, unknown>>();
      if (!packet) return json({ error: "Application packet not found." }, 404);
      const job = await env.DB.prepare("SELECT * FROM job_matches WHERE id = ? AND user_id = ?").bind(packet.job_id, user.id).first<Record<string, unknown>>();
      if (!job) return json({ error: "Job not found." }, 404);
      return json({ packet: buildBrowserPacket(await profileForUser(env, user), job, packet) });
    }

    return json({ error: "Not found" }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The request could not be completed.";
    return json({ error: message }, 400);
  }
}

export default worker;
