import { assessIndiaEligibility, type IndiaEligibilityAssessment } from "./job-eligibility";

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
  eligibilityHint?: string;
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
  classification: "Exceptional" | "Strong" | "Good" | "Borderline" | "Stretch" | "Skip";
  status: "HIGH_PRIORITY" | "READY_TO_APPLY" | "BORDERLINE" | "SKIPPED";
  breakdown: ScoreBreakdown;
  matchingExperience: string[];
  missingRequirements: string[];
  languageMismatch: string[];
  redFlags: string[];
  highPriority: boolean;
  resumeFit: "DEFAULT" | "CUSTOMIZE";
  resumeChanges: string[];
  semanticMatches: Array<{ requirement: string; evidence: string; confidence: "high" | "medium" }>;
  eligibility: IndiaEligibilityAssessment;
};

export const EMPTY_PROFILE: CandidateProfile = {
  name: "",
  email: "",
  title: "",
  experienceYears: 0,
  source: "resume",
  skills: [],
  domains: [],
  evidence: [],
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
const distributedTerms = ["distributed", "event-driven", "event driven", "queue", "pub/sub", "pubsub", "kafka", "rabbitmq", "sqs", "async", "asynchronous", "retry", "webhook", "caching", "system design"];
const dataTerms = ["mysql", "postgres", "postgresql", "mongodb", "redis", "sql", "database", "bigquery", "data infrastructure"];
const infraTerms = ["kubernetes", "docker", "gcp", "aws", "azure", "cloud", "autoscaling", "observability", "production", "reliability", "on-call"];
const aiTerms = ["voice ai", "conversational ai", "ai agent", "llm", "openai", "contact center", "communication api", "cpaas", "speech"];
const qualityTerms = ["product", "platform", "infrastructure", "scale", "ownership", "engineering", "saas", "developer"];
const rejectRoleTerms = ["frontend", "mobile developer", "qa engineer", "sdet", "data analyst", "data scientist", "technical support", "wordpress", "intern", "fresher", "graduate engineer"];

const semanticCatalog = [
  {
    requirement: "Message-driven systems",
    terms: ["kafka", "rabbitmq", "sqs", "nats", "message broker", "message queue"],
    expansion: "queue event-driven asynchronous retry distributed",
    confidence: "high" as const,
  },
  {
    requirement: "Workflow orchestration",
    terms: ["temporal", "workflow engine", "orchestration engine", "durable workflow"],
    expansion: "orchestration event-driven asynchronous retry webhook system design",
    confidence: "high" as const,
  },
  {
    requirement: "High-scale data systems",
    terms: ["large-scale database", "high scale database", "billions of rows", "database migration", "query performance"],
    expansion: "database mysql sql data infrastructure scale production",
    confidence: "high" as const,
  },
  {
    requirement: "Caching and low-latency services",
    terms: ["memcached", "distributed cache", "low latency", "performance optimization"],
    expansion: "redis caching scalable backend performance",
    confidence: "high" as const,
  },
  {
    requirement: "Cloud-native reliability",
    terms: ["aws", "azure", "eks", "ecs", "service reliability", "site reliability", "on call"],
    expansion: "cloud kubernetes docker autoscaling observability production reliability on-call",
    confidence: "medium" as const,
  },
  {
    requirement: "AI agent infrastructure",
    terms: ["agentic", "ai agents", "llm platform", "voice ai", "conversational ai", "real-time ai"],
    expansion: "ai agent llm voice ai communication api distributed backend production",
    confidence: "high" as const,
  },
] as const;

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
  const rawText = normalize([input.role, input.description, input.location, input.workMode].filter(Boolean).join(" "));
  const profileText = normalize([...profile.skills, ...profile.domains, ...profile.evidence].join(" "));
  const semanticMatches = semanticCatalog
    .filter((concept) => includesAny(rawText, [...concept.terms]) && includesAny(profileText, concept.expansion.split(" ").filter((term) => term.length > 3)))
    .map((concept) => {
      const evidence = profile.evidence.find((item) => includesAny(normalize(item), concept.expansion.split(" ").filter((term) => term.length > 3)))
        ?? [...profile.domains, ...profile.skills].find((item) => concept.expansion.includes(normalize(item)))
        ?? "Verified profile evidence";
      return { requirement: concept.requirement, evidence, confidence: concept.confidence };
    });
  const semanticExpansion = semanticCatalog
    .filter((concept) => semanticMatches.some((match) => match.requirement === concept.requirement))
    .map((concept) => concept.expansion)
    .join(" ");
  const text = `${rawText} ${semanticExpansion}`.trim();
  const profileSkills = normalize(profile.skills.join(" "));
  const matchingExperience: string[] = [];
  const missingRequirements: string[] = [];
  const languageMismatch: string[] = [];
  const redFlags: string[] = [];
  const eligibility = assessIndiaEligibility(input);

  const alignedDimension = (terms: string[], max: number) => {
    const required = terms.filter((term) => text.includes(term));
    if (!required.length) return Math.round(max * 0.45);
    const supplied = required.filter((term) => profileText.includes(term));
    return Math.round(max * (supplied.length / required.length));
  };
  const backend = alignedDimension(backendTerms, 20);
  const distributed = alignedDimension(distributedTerms, 15);
  const data = alignedDimension(dataTerms, 10);
  const infrastructure = alignedDimension(infraTerms, 10);
  const aiVoice = alignedDimension(aiTerms, 10);

  const jdStack = ["node.js", "nodejs", "typescript", "nestjs", "java", "spring", "python", "golang", "go", "c++"].filter((term) => text.includes(term));
  const exactStackCount = jdStack.filter((term) => profileSkills.includes(term)).length;
  const languageFlexible = includesAny(text, ["language agnostic", "language-independent", "any programming language", "strong programming fundamentals"]);
  let stack = exactStackCount >= 2 ? 15 : exactStackCount === 1 ? 12 : languageFlexible ? 9 : jdStack.length ? 3 : 7;

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
  if (eligibility.decision === "INELIGIBLE") redFlags.push(...eligibility.reasons);
  else if (eligibility.decision === "VERIFY") redFlags.push(`Eligibility needs verification: ${eligibility.reasons[0]}`);

  const classification = score >= 90 ? "Exceptional" : score >= 82 ? "Strong" : score >= 75 ? "Good" : score >= 65 ? "Borderline" : score >= 50 ? "Stretch" : "Skip";
  const highPriority = score >= 82 && backend >= 14 && distributed >= 9 && aiVoice >= 6 && eligibility.decision === "ELIGIBLE";
  const status = score < 50 || eligibility.decision === "INELIGIBLE" || redFlags.some((flag) => /outside the target|domain mismatch|Requires 6|Requires 7|Requires 8|Requires 9/.test(flag))
    ? "SKIPPED"
    : highPriority
      ? "HIGH_PRIORITY"
      : score >= 75
        ? "READY_TO_APPLY"
        : "BORDERLINE";

  const alignedEvidence = profile.evidence.filter((item) => {
    const normalized = normalize(item);
    return [...backendTerms, ...distributedTerms, ...dataTerms, ...infraTerms, ...aiTerms, ...jdStack].some((term) => normalized.includes(term));
  });
  matchingExperience.push(...alignedEvidence.slice(0, 6));
  if (exactStackCount > 0) matchingExperience.push(`Direct stack alignment: ${jdStack.filter((term) => profileSkills.includes(term)).join(", ")}`);
  matchingExperience.push(...semanticMatches.map((match) => `${match.requirement}: ${match.evidence}`));

  for (const [label, term] of [["AWS", "aws"], ["Kafka", "kafka"], ["gRPC", "grpc"], ["Vector databases", "vector database"]] as const) {
    if (text.includes(term) && !profileSkills.includes(term)) missingRequirements.push(label);
  }
  missingRequirements.push(...languageMismatch.map((item) => `${item} production depth`));

  const resumeChanges: string[] = [];
  if (alignedEvidence.length) resumeChanges.push(`Move the strongest verified evidence for this role higher: ${alignedEvidence[0]}`);
  if (exactStackCount) resumeChanges.push(`Keep verified ${jdStack.filter((term) => profileSkills.includes(term)).join(" / ")} experience visible near the top.`);
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
    semanticMatches,
    eligibility,
  };
}

export function profileFromResumeText(rawText: string, fallbackName = "", fallbackEmail = ""): CandidateProfile {
  const text = rawText.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
  const lower = normalize(text);
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const parsedEmail = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? fallbackEmail;
  const parsedName = lines.slice(0, 8).find((line) => {
    if (line.length < 3 || line.length > 80 || /@|https?:|linkedin|github|resume|curriculum|engineer|developer|phone|mobile|\d{3}/i.test(line)) return false;
    const words = line.split(/\s+/);
    return words.length >= 2 && words.length <= 5 && words.every((word) => /^[A-Za-z.'-]+$/.test(word));
  }) ?? fallbackName;
  const skills = skillCatalog.filter((skill) => {
    if (skill === "Go" || skill === "Golang") return /\b(?:go|golang)\b/.test(lower);
    if (skill === "Java") return /\bjava\b/.test(lower);
    return lower.includes(normalize(skill));
  });
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
    name: parsedName,
    email: parsedEmail,
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
