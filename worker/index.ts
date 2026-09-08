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

type FreehireJob = {
  public_slug?: string;
  external_id?: string;
  url?: string;
  title?: string;
  company?: string;
  location?: string;
  description?: string;
  skills?: string[];
  work_mode?: string;
  regions?: string[];
  countries?: string[];
  cities?: string[];
  posted_at?: string | null;
  enrichment?: {
    seniority?: string;
    category?: string;
    employment_type?: string;
    salary_min?: number;
    salary_max?: number;
    salary_currency?: string;
  };
};

type RemotiveJob = {
  id?: number | string;
  url?: string;
  title?: string;
  company_name?: string;
  category?: string;
  job_type?: string;
  publication_date?: string;
  candidate_required_location?: string;
  salary?: string;
  description?: string;
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

// `profile` drives the default keywords/name so a discovery search someone hasn't
// customized yet still searches for roles matching *their* resume rather than a
// hardcoded backend-engineering default. See lib/discovery-query.ts.
function discoveryConfig(body: Record<string, unknown>, profile: CandidateProfile = EMPTY_PROFILE): DiscoveryConfig {
  const fallbackKeywords = defaultDiscoveryKeywords(profile);
  return {
    name: asString(body.name, defaultDiscoveryName(profile)).slice(0, 80),
    keywords: stringList(body.keywords, fallbackKeywords),
    locations: stringList(body.locations, ["India", "Remote", "Worldwide", "APAC"]),
    workModes: stringList(body.workModes, ["Remote", "Hybrid"]),
    portals: stringList(body.portals, ["Freehire", "Remotive", "Jobicy", "Arbeitnow", "Connected ATS boards"]),
    minScore: Math.max(50, Math.min(95, Number(body.minScore ?? 65))),
  };
}

function isDiscoveryCandidate(job: JobInput, config: DiscoveryConfig) {
  return isDiscoveryCandidateGeneric(job, config, inferWorkMode);
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
  const effectiveThreshold = Math.max(70, threshold, Number(preferences?.match_threshold ?? 75));
  const limit = Math.max(1, Math.min(20, Number(preferences?.daily_limit ?? 5)));
  const staged: Array<{ packetId: string; jobId: string; status: string }> = [];
  for (const row of rows.filter((job) => {
    const scored = parseJson<Record<string, unknown>>(job.score_json, {});
    const eligibility = scored.eligibility as Record<string, unknown> | undefined;
    return Number(job.match_score) >= effectiveThreshold && job.status !== "SKIPPED" && eligibility?.decision === "ELIGIBLE";
  }).slice(0, limit)) {
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
    automatic("freehire", "Freehire", "India + worldwide remote ATS jobs"),
    automatic("remotive", "Remotive", "Curated worldwide remote jobs"),
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

function freehireSalary(job: FreehireJob) {
  const enrichment = job.enrichment ?? {};
  if (enrichment.salary_min == null && enrichment.salary_max == null) return "";
  const range = [enrichment.salary_min, enrichment.salary_max].filter((value) => value != null).join("-");
  return [enrichment.salary_currency, range].filter(Boolean).join(" ");
}

function freehireWorkMode(job: FreehireJob) {
  const mode = asString(job.work_mode).toLowerCase();
  if (mode === "remote") return "Remote";
  if (mode === "hybrid") return "Hybrid";
  if (mode === "onsite" || mode === "on-site") return "On-site";
  return inferWorkMode(asString(job.location), asString(job.description));
}

async function fetchFreehireDiscovery(config: DiscoveryConfig): Promise<DiscoveryProviderResult> {
  const wantsIndia = config.locations.some((value) => /india|bengaluru|bangalore|hyderabad|pune|mumbai|delhi|gurugram|noida|chennai/i.test(value));
  const wantsRemote = config.workModes.some((value) => value.toLowerCase() === "remote")
    || config.locations.some((value) => /remote|worldwide|global|apac/i.test(value));
  const query = config.keywords.slice(0, 8).join(" ");
  const urls: URL[] = [];
  if (wantsIndia) {
    const indiaUrl = new URL("https://freehire.me/api/v1/agent/jobs/search");
    indiaUrl.searchParams.set("q", query);
    indiaUrl.searchParams.set("countries", "IN");
    indiaUrl.searchParams.set("posted_within_days", "30");
    indiaUrl.searchParams.set("description_format", "text");
    indiaUrl.searchParams.set("limit", "50");
    urls.push(indiaUrl);
  }
  if (wantsRemote) {
    const remoteUrl = new URL("https://freehire.me/api/v1/agent/jobs/search");
    remoteUrl.searchParams.set("q", query);
    remoteUrl.searchParams.set("work_mode", "remote");
    for (const region of ["global", "apac", "none"]) remoteUrl.searchParams.append("regions", region);
    remoteUrl.searchParams.set("posted_within_days", "30");
    remoteUrl.searchParams.set("description_format", "text");
    remoteUrl.searchParams.set("limit", "50");
    urls.push(remoteUrl);
  }
  if (!urls.length) return { provider: "Freehire", discovered: 0, candidates: [] };
  const responses = await Promise.all(urls.map((url) => safeJsonFetch(url.toString()).then((response) => response.json() as Promise<{ data?: FreehireJob[] }>)));
  const jobs = [...new Map(responses.flatMap((payload) => payload.data ?? []).map((job) => [asString(job.public_slug, asString(job.url)), job])).values()];
  const candidates = jobs.map((job): JobInput => {
    const regions = Array.isArray(job.regions) ? job.regions : [];
    const countries = Array.isArray(job.countries) ? job.countries : [];
    const cities = Array.isArray(job.cities) ? job.cities : [];
    const location = asString(job.location, [...cities, ...countries].join(", ") || "Not specified");
    const applicationUrl = asString(job.url, job.public_slug ? `https://freehire.me/jobs/${job.public_slug}` : "");
    return {
      externalId: asString(job.public_slug, asString(job.external_id, applicationUrl)),
      company: asString(job.company, "Unknown company"),
      role: asString(job.title, "Untitled role"),
      location,
      workMode: freehireWorkMode(job),
      platform: "Freehire",
      applicationUrl,
      postedDate: asString(job.posted_at),
      description: stripHtml([asString(job.description), ...(job.skills ?? [])].filter(Boolean).join(" ")),
      compensation: freehireSalary(job),
      eligibilityHint: `regions: ${regions.join(", ")}; countries: ${countries.join(", ")}; cities: ${cities.join(", ")}`,
    };
  }).filter((job) => job.applicationUrl && isDiscoveryCandidate(job, config));
  return { provider: "Freehire", discovered: jobs.length, candidates };
}

async function fetchRemotiveDiscovery(config: DiscoveryConfig): Promise<DiscoveryProviderResult> {
  const url = new URL("https://remotive.com/api/remote-jobs");
  url.searchParams.set("category", "software-dev");
  url.searchParams.set("limit", "100");
  const payload = await safeJsonFetch(url.toString()).then((response) => response.json() as Promise<{ jobs?: RemotiveJob[] }>);
  const jobs = payload.jobs ?? [];
  const candidates = jobs.map((job): JobInput => ({
    externalId: String(job.id ?? job.url ?? ""),
    company: asString(job.company_name, "Unknown company"),
    role: asString(job.title, "Untitled role"),
    location: asString(job.candidate_required_location, "Remote"),
    workMode: "Remote",
    platform: "Remotive",
    applicationUrl: asString(job.url),
    postedDate: asString(job.publication_date),
    description: stripHtml(`${asString(job.description)} ${asString(job.category)} ${asString(job.job_type)}`),
    compensation: asString(job.salary),
    eligibilityHint: asString(job.candidate_required_location),
  })).filter((job) => job.applicationUrl && isDiscoveryCandidate(job, config));
  return { provider: "Remotive", discovered: jobs.length, candidates };
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
