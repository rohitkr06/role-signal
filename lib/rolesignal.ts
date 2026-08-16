export type CandidateProfile = {
  name: string;
  email: string;
  title: string;
  experienceYears: number;
  skills: string[];
  domains: string[];
  evidence: string[];
  source: "verified-brief" | "resume";
};

export type JobInput = {
  externalId?: string;
  company: string;
  role: string;
  location: string;
  workMode?: string;
  platform?: string;
  applicationUrl: string;
  postedDate?: string;
  description: string;
  compensation?: string;
};

export type ScoreBreakdown = {
  backend: number;
  distributed: number;
  stack: number;
  data: number;
  infrastructure: number;
  aiVoice: number;
  experience: number;
  companyQuality: number;
  recency: number;
  penalties: number;
};

export type ScoredJob = JobInput & {
  fingerprint: string;
  score: number;
  classification: "Exceptional" | "Strong" | "Good" | "Borderline" | "Skip";
  status: "HIGH_PRIORITY" | "READY_TO_APPLY" | "BORDERLINE" | "SKIPPED";
  breakdown: ScoreBreakdown;
  matchingExperience: string[];
  missingRequirements: string[];
  languageMismatch: string[];
  redFlags: string[];
  highPriority: boolean;
  resumeFit: "DEFAULT" | "CUSTOMIZE";
  resumeChanges: string[];
};

export const ROHIT_PROFILE: CandidateProfile = {
  name: "Rohit Kumar",
  email: "",
  title: "Software Development Engineer II",
  experienceYears: 3,
  source: "verified-brief",
  skills: [
    "TypeScript", "JavaScript", "SQL", "Node.js", "NestJS", "REST APIs",
    "Microservices", "TypeORM", "Sequelize", "MySQL", "MongoDB", "Redis",
    "BigQuery", "GCP", "Pub/Sub", "Cloud Tasks", "Kubernetes", "Docker",
    "OpenAI", "Retell AI", "Twilio", "Deepgram", "Langfuse", "Grafana",
    "New Relic", "Sentry", "PagerDuty", "Distributed Tracing",
  ],
  domains: [
    "Distributed systems", "Event-driven architecture", "AI voice agents",
    "Asynchronous processing", "Multi-tenant SaaS", "Production reliability",
    "Caching", "Webhooks", "System design", "Backend infrastructure",
  ],
  evidence: [
    "Scaled an AI voice platform to 7,000+ customers and roughly 5,000 calls per day.",
    "Built pre-call, in-call and post-call orchestration for enterprise workflows.",
    "Designed a fault-isolated pipeline with GCP Pub/Sub, Cloud Tasks, webhooks and retries.",
    "Reduced database load by roughly 60% with Redis configuration caching.",
    "Optimized Kubernetes workloads for a roughly 33% lower memory footprint.",
    "Led a zero-downtime MySQL migration spanning 100M+ rows and 120GB+ of data.",
  ],
};

const skillCatalog = [
  "TypeScript", "JavaScript", "SQL", "Node.js", "NestJS", "REST APIs",
  "Microservices", "TypeORM", "Sequelize", "MySQL", "MongoDB", "Redis",
  "BigQuery", "GCP", "Pub/Sub", "Cloud Tasks", "Kubernetes", "Docker",
  "OpenAI", "Retell AI", "Twilio", "Deepgram", "Langfuse", "Grafana",
  "New Relic", "Sentry", "PagerDuty", "LaunchDarkly", "PHP", "C++",
  "Python", "Java", "Golang", "Go", "AWS", "Kafka", "gRPC",
];

const backendTerms = ["backend", "api", "microservice", "service", "server", "scalable", "architecture"];
const distributedTerms = ["distributed", "event-driven", "event driven", "queue", "pub/sub", "pubsub", "async", "asynchronous", "retry", "webhook", "caching", "system design"];
const dataTerms = ["mysql", "mongodb", "redis", "sql", "database", "bigquery", "data infrastructure"];
const infraTerms = ["kubernetes", "docker", "gcp", "cloud", "autoscaling", "observability", "production", "reliability", "on-call"];
const aiTerms = ["voice ai", "conversational ai", "ai agent", "llm", "openai", "contact center", "communication api", "cpaas", "speech"];
const qualityTerms = ["product", "platform", "infrastructure", "scale", "ownership", "engineering", "saas", "developer"];
const rejectRoleTerms = ["frontend", "mobile developer", "qa engineer", "sdet", "data analyst", "data scientist", "technical support", "wordpress", "intern", "fresher", "graduate engineer"];

function normalize(value: string) {
  return value.toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
}

function includesAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function matchedCount(text: string, terms: string[]) {
  return terms.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0);
}

function scaled(count: number, max: number, saturation: number) {
  return Math.min(max, Math.round((Math.min(count, saturation) / saturation) * max));
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function experienceRequirement(text: string) {
  const range = text.match(/(\d+)\s*(?:-|to)\s*(\d+)\s*(?:\+\s*)?(?:years?|yrs?)/i);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const single = text.match(/(\d+)\s*\+\s*(?:years?|yrs?)/i);
  if (single) return { min: Number(single[1]), max: 99 };
  return null;
}

function recencyScore(postedDate = "", now = new Date()) {
  const posted = normalize(postedDate);
  if (!posted) return 2;
  if (/hour|today|just posted|24\s*h/.test(posted)) return 5;
  const days = posted.match(/(\d+)\s*d(?:ay)?/);
  if (days) {
    const value = Number(days[1]);
    if (value <= 1) return 5;
    if (value <= 3) return 4;
    if (value <= 7) return 3;
    return 1;
  }
  const parsed = new Date(postedDate);
  if (!Number.isNaN(parsed.getTime())) {
    const ageDays = Math.max(0, (now.getTime() - parsed.getTime()) / 86_400_000);
    if (ageDays <= 1) return 5;
    if (ageDays <= 3) return 4;
    if (ageDays <= 7) return 3;
    return 1;
  }
  return 2;
}

export function jobFingerprint(company: string, role: string, location: string) {
  return [company, role, location]
    .map((value) => normalize(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""))
    .join("|");
}

export function scoreJob(profile: CandidateProfile, input: JobInput, now = new Date()): ScoredJob {
  const text = normalize([input.role, input.description, input.location, input.workMode].filter(Boolean).join(" "));
  const profileSkills = normalize(profile.skills.join(" "));
  const matchingExperience: string[] = [];
  const missingRequirements: string[] = [];
  const languageMismatch: string[] = [];
  const redFlags: string[] = [];

  const backendCount = matchedCount(text, backendTerms);
  const distributedCount = matchedCount(text, distributedTerms);
  const dataCount = matchedCount(text, dataTerms);
  const infraCount = matchedCount(text, infraTerms);
  const aiCount = matchedCount(text, aiTerms);

  const backend = Math.max(text.includes("backend") ? 12 : 0, scaled(backendCount, 20, 5));
  const distributed = scaled(distributedCount, 15, 5);
  const data = scaled(dataCount, 10, 4);
  const infrastructure = scaled(infraCount, 10, 5);
  const aiVoice = scaled(aiCount, 10, 3);

  const exactStackCount = matchedCount(text, ["node.js", "nodejs", "typescript", "nestjs"]);
  const languageFlexible = includesAny(text, ["language agnostic", "language-independent", "any programming language", "strong programming fundamentals"]);
  let stack = exactStackCount >= 2 ? 15 : exactStackCount === 1 ? 12 : languageFlexible ? 9 : 6;

  const languages = [
    ["Java / Spring", ["java", "spring"]],
    ["Go", ["golang", " go "]],
    ["Python", ["python", "fastapi", "django"]],
    ["C++", ["c++"]],
  ] as const;
  for (const [label, terms] of languages) {
    if (includesAny(` ${text} `, terms) && !profileSkills.includes(normalize(label.split(" /")[0]))) {
      languageMismatch.push(label);
    }
  }
  const strictLanguage = includesAny(text, ["must have java", "strong java/spring", "expert in java", "golang required", "expert c++", "deep c++", "python required", "fastapi required"]);
  if (strictLanguage && languageMismatch.length) {
    stack = Math.min(stack, 3);
    redFlags.push(`Mandatory stack depth: ${languageMismatch.join(", ")}`);
  }

  const requirement = experienceRequirement(text);
  let experience = 8;
  if (requirement) {
    if (requirement.min >= 6) {
      experience = 0;
      redFlags.push(`Requires ${requirement.min}+ years of experience`);
    } else if (profile.experienceYears >= requirement.min && profile.experienceYears <= requirement.max) {
      experience = 10;
    } else if (requirement.min <= 4) {
      experience = 6;
    } else {
      experience = 3;
    }
  }

  const companyQuality = scaled(matchedCount(text, qualityTerms), 5, 3);
  const recency = recencyScore(input.postedDate, now);
  let penalties = 0;
  if (includesAny(normalize(input.role), rejectRoleTerms)) {
    penalties -= 45;
    redFlags.push("Role family is outside the target profile");
  }
  if (strictLanguage && languageMismatch.length) penalties -= 12;
  if (requirement?.min && requirement.min >= 6) penalties -= 18;
  if (/devops[- ]only|php[- ]only|heavy frontend|primarily frontend/.test(text)) {
    penalties -= 30;
    redFlags.push("Engineering-domain mismatch");
  }

  const breakdown: ScoreBreakdown = {
    backend,
    distributed,
    stack,
    data,
    infrastructure,
    aiVoice,
    experience,
    companyQuality,
    recency,
    penalties,
  };
  const score = Math.max(0, Math.min(100, Object.values(breakdown).reduce((sum, value) => sum + value, 0)));
  const classification = score >= 90 ? "Exceptional" : score >= 82 ? "Strong" : score >= 75 ? "Good" : score >= 65 ? "Borderline" : "Skip";
  const highPriority = score >= 82 && backend >= 14 && distributed >= 9 && aiVoice >= 6;
  const status = score < 65 || redFlags.some((flag) => /outside|domain mismatch|Requires 6|Requires 7|Requires 8|Requires 9/.test(flag))
    ? "SKIPPED"
    : highPriority
      ? "HIGH_PRIORITY"
      : score >= 75
        ? "READY_TO_APPLY"
        : "BORDERLINE";

  if (backend >= 14) matchingExperience.push("Production backend services, APIs and microservices");
  if (distributed >= 9) matchingExperience.push("Event-driven orchestration, queues, retries and fault isolation");
  if (data >= 6) matchingExperience.push("MySQL, MongoDB and Redis at production scale");
  if (infrastructure >= 6) matchingExperience.push("Kubernetes, GCP, observability and production ownership");
  if (aiVoice >= 6) matchingExperience.push("AI voice agents and real-time communication infrastructure");
  if (exactStackCount > 0) matchingExperience.push("Direct Node.js / TypeScript stack alignment");

  for (const [label, term] of [["AWS", "aws"], ["Kafka", "kafka"], ["gRPC", "grpc"], ["Vector databases", "vector database"]] as const) {
    if (text.includes(term) && !profileSkills.includes(term)) missingRequirements.push(label);
  }
  missingRequirements.push(...languageMismatch.map((item) => `${item} production depth`));

  const resumeChanges: string[] = [];
  if (distributed >= 9) resumeChanges.push("Move Pub/Sub, Cloud Tasks and retry-architecture evidence into the first experience block.");
  if (data >= 6) resumeChanges.push("Elevate the Redis caching and 100M+ row MySQL migration outcomes.");
  if (aiVoice >= 6) resumeChanges.push("Lead with AIVA scale, call orchestration and production AI integrations.");
  if (infrastructure >= 6) resumeChanges.push("Keep Kubernetes scaling and reliability ownership visible above secondary skills.");
  if (languageMismatch.length) resumeChanges.push(`Frame ${languageMismatch.join(" / ")} as a ramp-up area while emphasizing transferable backend architecture.`);

  return {
    ...input,
    fingerprint: jobFingerprint(input.company, input.role, input.location),
    score,
    classification,
    status,
    breakdown,
    matchingExperience: unique(matchingExperience),
    missingRequirements: unique(missingRequirements),
    languageMismatch: unique(languageMismatch),
    redFlags: unique(redFlags),
    highPriority,
    resumeFit: resumeChanges.length >= 2 ? "CUSTOMIZE" : "DEFAULT",
    resumeChanges: unique(resumeChanges).slice(0, 5),
  };
}

export function profileFromResumeText(rawText: string, name = "Rohit Kumar", email = ""): CandidateProfile {
  const text = rawText.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
  const lower = normalize(text);
  const skills = skillCatalog.filter((skill) => lower.includes(normalize(skill)));
  const evidence = text
    .split(/\n+/)
    .map((line) => line.replace(/^[\s•·*-]+/, "").trim())
    .filter((line) => line.length >= 35 && line.length <= 280)
    .filter((line) => /\d|built|designed|architected|scaled|reduced|improved|migrated|optimized|led/i.test(line))
    .slice(0, 10);
  const domains = [
    ["Distributed systems", ["distributed", "pub/sub", "queue", "cloud tasks"]],
    ["Event-driven architecture", ["event-driven", "event driven", "webhook", "asynchronous"]],
    ["AI voice agents", ["voice agent", "voice ai", "retell", "twilio", "deepgram"]],
    ["Production reliability", ["pagerduty", "on-call", "grafana", "sentry", "new relic"]],
    ["Backend infrastructure", ["backend", "microservice", "kubernetes", "api"]],
  ].filter(([, terms]) => includesAny(lower, terms as string[])).map(([domain]) => domain as string);
  const experienceMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:\+\s*)?(?:years?|yrs?)\s+(?:of\s+)?(?:professional\s+)?experience/);
  const title = /software development engineer ii|sde[- ]?2/.test(lower)
    ? "Software Development Engineer II"
    : /senior backend engineer/.test(lower)
      ? "Senior Backend Engineer"
      : /backend engineer/.test(lower)
        ? "Backend Engineer"
        : "Software Engineer";
  return {
    name,
    email,
    title,
    experienceYears: experienceMatch ? Number(experienceMatch[1]) : 0,
    skills: unique(skills),
    domains: unique(domains),
    evidence: unique(evidence),
    source: "resume",
  };
}

export function stripHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function inferWorkMode(location: string, description = "") {
  const text = normalize(`${location} ${description}`);
  if (text.includes("remote")) return "Remote";
  if (text.includes("hybrid")) return "Hybrid";
  return "On-site";
}

export function inferPlatform(url: string) {
  const host = (() => {
    try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
  })();
  if (host.includes("greenhouse")) return "Greenhouse";
  if (host.includes("lever.co")) return "Lever";
  if (host.includes("ashbyhq")) return "Ashby";
  if (host.includes("linkedin")) return "LinkedIn";
  return "Company site";
}
