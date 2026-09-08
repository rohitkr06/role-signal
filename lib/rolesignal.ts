import { assessIndiaEligibility, type IndiaEligibilityAssessment } from "./job-eligibility.ts";
import { categoriesForSkills, categorizeText, extractTaxonomySkills, formatSkillTerm, skillTaxonomy, type CategoryMatch } from "./skill-taxonomy.ts";

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
  coreSkills: number;
  domainAlignment: number;
  toolsAndKeywords: number;
  specificMatch: number;
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
  /** The job's inferred professional category, e.g. "Marketing & Growth" or "Software Engineering (Backend & Systems)". */
  roleCategory: string | null;
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

// Kept as a supplementary, additive signal on top of the general taxonomy match below.
// These concepts are deliberately still engineering-flavored; they add a small bonus for
// technical roles and simply never fire for non-technical resumes/jobs, so they don't bias
// against any other domain the way the old hardcoded scoring dimensions used to.
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

// Categories where a specific-programming-language mismatch is a meaningful signal.
// Outside these, "requires Java" in a job description is irrelevant noise, not a red flag.
const languageSensitiveCategories = new Set(["software-backend", "data-science-ml", "cloud-devops-sre", "data-analytics", "frontend-mobile"]);

const qualityTerms = [
  "product", "platform", "infrastructure", "scale", "ownership", "engineering", "saas", "developer",
  "leadership", "growth", "impact", "cross-functional", "stakeholder", "mission-driven", "customer-obsessed",
];

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

function titleCase(value: string) {
  return value.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}

function dedupeCaseInsensitive(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
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

/**
 * A "neutral" score for a dimension when we couldn't confidently read a
 * requirement out of the job description at all (rather than penalizing the
 * candidate for a job posting that's just thin on detail).
 */
function neutralFraction() {
  return 0.45;
}

export function scoreJob(profile: CandidateProfile, input: JobInput, now = new Date()): ScoredJob {
  const rawText = normalize([input.role, input.description, input.location, input.workMode].filter(Boolean).join(" "));
  const profileText = normalize([...profile.skills, ...profile.domains, ...profile.evidence].join(" "));
  const profileSkillsLower = profile.skills.map((skill) => skill.toLowerCase());

  const jdCategories: CategoryMatch[] = categorizeText(`${input.role} ${input.description}`);
  const topJdCategory = jdCategories[0] ?? null;
  const secondJdCategory = jdCategories[1] ?? null;
  const profileCategories = categoriesForSkills(profile.skills);
  const profileCategoryIds = new Set(profileCategories.map((match) => match.categoryId));
  // A resume's stored `domains` are already category labels derived at parse time; fold
  // those in too so edits made to domains without re-parsing skills still count.
  const profileDomainLabels = new Set(profile.domains.map((domain) => domain.toLowerCase()));

  const semanticMatches = semanticCatalog
    .filter((concept) => includesAny(rawText, [...concept.terms]) && includesAny(profileText, concept.expansion.split(" ").filter((term) => term.length > 3)))
    .map((concept) => {
      const evidence = profile.evidence.find((item) => includesAny(normalize(item), concept.expansion.split(" ").filter((term) => term.length > 3)))
        ?? [...profile.domains, ...profile.skills].find((item) => concept.expansion.includes(normalize(item)))
        ?? "Verified profile evidence";
      return { requirement: concept.requirement, evidence, confidence: concept.confidence };
    });

  const matchingExperience: string[] = [];
  const missingRequirements: string[] = [];
  const languageMismatch: string[] = [];
  const redFlags: string[] = [];
  const eligibility = assessIndiaEligibility(input);

  // --- coreSkills (0-30): how much of the JD's primary-category vocabulary the candidate has. ---
  // Checked against the full verified profile text (skills + domains + evidence), not just
  // the flat skills list, so a term the candidate only demonstrated in an evidence bullet
  // (e.g. "designed event-driven Kafka workflows") still counts as coverage.
  let coreSkills: number;
  const topRequiredTerms = topJdCategory?.matchedTerms ?? [];
  if (topRequiredTerms.length) {
    const supplied = topRequiredTerms.filter((term) => profileText.includes(term.toLowerCase()));
    coreSkills = Math.round(30 * (supplied.length / topRequiredTerms.length));
  } else {
    coreSkills = Math.round(30 * neutralFraction());
  }

  // --- domainAlignment (0-20): does the candidate's own category match the job's? ---
  let domainAlignment: number;
  const profileHasTop = topJdCategory ? profileCategoryIds.has(topJdCategory.categoryId) || profileDomainLabels.has(topJdCategory.label.toLowerCase()) : false;
  const profileHasSecond = secondJdCategory ? profileCategoryIds.has(secondJdCategory.categoryId) || profileDomainLabels.has(secondJdCategory.label.toLowerCase()) : false;
  if (!topJdCategory) domainAlignment = 10;
  else if (profileHasTop) domainAlignment = 20;
  else if (profileHasSecond) domainAlignment = 12;
  else domainAlignment = 0;

  // --- toolsAndKeywords (0-15): broader overlap across every category the JD touched. ---
  const allJdTerms = unique(jdCategories.slice(0, 4).flatMap((match) => match.matchedTerms));
  let toolsAndKeywords: number;
  if (allJdTerms.length) {
    const supplied = allJdTerms.filter((term) => profileText.includes(term.toLowerCase()));
    toolsAndKeywords = Math.round(15 * (supplied.length / allJdTerms.length));
  } else {
    toolsAndKeywords = Math.round(15 * neutralFraction());
  }

  // --- specificMatch (0-10): exact-term overlap on the most specific requirements. ---
  const specificTerms = [...(topJdCategory?.matchedTerms ?? []), ...(secondJdCategory?.matchedTerms ?? [])].slice(0, 8);
  const specificSupplied = specificTerms.filter((term) => profileSkillsLower.includes(term.toLowerCase()));
  let specificMatch: number;
  if (specificSupplied.length >= 2) specificMatch = 10;
  else if (specificSupplied.length === 1) specificMatch = 7;
  else if (specificTerms.length) specificMatch = 2;
  else specificMatch = 5;

  // --- language/tool-specific mismatch, only meaningful for technical categories ---
  const jdIsTechnical = [topJdCategory?.categoryId, secondJdCategory?.categoryId].some((id) => id && languageSensitiveCategories.has(id));
  const languages = [
    ["Java / Spring", ["java", "spring"]],
    ["Go", ["golang", " go "]],
    ["Python", ["python", "fastapi", "django"]],
    ["C++", ["c++"]],
  ] as const;
  if (jdIsTechnical) {
    for (const [label, terms] of languages) {
      if (includesAny(` ${rawText} `, terms) && !profileSkillsLower.includes(normalize(label.split(" /")[0]))) {
        languageMismatch.push(label);
      }
    }
  }
  const strictLanguage = jdIsTechnical && includesAny(rawText, ["must have java", "strong java/spring", "expert in java", "golang required", "expert c++", "deep c++", "python required", "fastapi required"]);
  if (strictLanguage && languageMismatch.length) {
    specificMatch = Math.min(specificMatch, 3);
    redFlags.push(`Mandatory stack depth: ${languageMismatch.join(", ")}`);
  }

  // --- experience (0-10) ---
  const requirement = experienceRequirement(rawText);
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

  const companyQuality = scaled(matchedCount(rawText, qualityTerms), 10, 6);
  const recency = recencyScore(input.postedDate, now);

  // --- penalties ---
  let penalties = 0;
  let hardExclude = false;
  const jdConfidentlyCategorized = Boolean(topJdCategory && topJdCategory.score >= 3);
  if (jdConfidentlyCategorized && topJdCategory && !profileHasTop && !profileHasSecond) {
    penalties -= 35;
    hardExclude = true;
    redFlags.push(`Role family "${topJdCategory.label}" doesn't match your profile's focus${profile.domains[0] ? ` (${profile.domains[0]})` : ""}.`);
  }
  if (strictLanguage && languageMismatch.length) penalties -= 12;
  if (requirement?.min && requirement.min >= 6) {
    penalties -= 18;
    hardExclude = true;
  }

  const breakdown: ScoreBreakdown = {
    coreSkills,
    domainAlignment,
    toolsAndKeywords,
    specificMatch,
    experience,
    companyQuality,
    recency,
    penalties,
  };
  const score = Math.max(0, Math.min(100, Object.values(breakdown).reduce((sum, value) => sum + value, 0)));
  if (eligibility.decision === "INELIGIBLE") { redFlags.push(...eligibility.reasons); hardExclude = true; }
  else if (eligibility.decision === "VERIFY") redFlags.push(`Eligibility needs verification: ${eligibility.reasons[0]}`);

  const classification = score >= 90 ? "Exceptional" : score >= 82 ? "Strong" : score >= 75 ? "Good" : score >= 65 ? "Borderline" : score >= 50 ? "Stretch" : "Skip";
  const highPriority = score >= 82 && coreSkills >= 20 && domainAlignment >= 16 && eligibility.decision === "ELIGIBLE";
  const status = hardExclude || score < 50
    ? "SKIPPED"
    : highPriority
      ? "HIGH_PRIORITY"
      : score >= 75
        ? "READY_TO_APPLY"
        : "BORDERLINE";

  const relevantTerms = unique([...(topJdCategory?.matchedTerms ?? []), ...(secondJdCategory?.matchedTerms ?? [])]);
  const alignedEvidence = profile.evidence.filter((item) => {
    const normalized = normalize(item);
    return relevantTerms.some((term) => normalized.includes(term));
  });
  matchingExperience.push(...alignedEvidence.slice(0, 6));
  if (specificSupplied.length) matchingExperience.push(`Direct alignment: ${specificSupplied.map(formatSkillTerm).join(", ")}`);
  matchingExperience.push(...semanticMatches.map((match) => `${match.requirement}: ${match.evidence}`));

  for (const term of relevantTerms.slice(0, 8)) {
    if (!profileText.includes(term.toLowerCase())) missingRequirements.push(formatSkillTerm(term));
  }
  missingRequirements.push(...languageMismatch.map((item) => `${item} production depth`));

  const resumeChanges: string[] = [];
  const focusLabel = topJdCategory?.label ?? "this role";
  if (alignedEvidence.length) resumeChanges.push(`Move the strongest verified evidence for ${focusLabel} higher: ${alignedEvidence[0]}`);
  if (specificSupplied.length) resumeChanges.push(`Keep verified ${specificSupplied.slice(0, 3).map(formatSkillTerm).join(" / ")} experience visible near the top.`);
  if (languageMismatch.length) resumeChanges.push(`Frame ${languageMismatch.join(" / ")} as a ramp-up area while emphasizing transferable experience.`);

  return {
    ...input,
    fingerprint: jobFingerprint(input.company, input.role, input.location),
    score,
    classification,
    status,
    breakdown,
    matchingExperience: unique(matchingExperience),
    missingRequirements: unique(missingRequirements).slice(0, 8),
    languageMismatch: unique(languageMismatch),
    redFlags: unique(redFlags),
    highPriority,
    resumeFit: resumeChanges.length >= 2 ? "CUSTOMIZE" : "DEFAULT",
    resumeChanges: unique(resumeChanges).slice(0, 5),
    semanticMatches,
    eligibility,
    roleCategory: topJdCategory?.label ?? null,
  };
}

const skillSectionHeading = /^(technical\s+)?skills|core\s+competencies|tools\s*(&|and)?\s*technologies|technical\s+expertise|areas\s+of\s+expertise$/i;

/**
 * Picks up skill-like tokens listed under a resume's own "Skills" (or similar)
 * heading even when the term isn't in the curated taxonomy. This is what keeps
 * the profile from being limited to a fixed vocabulary: anything the candidate
 * explicitly lists as a skill is trusted evidence, taxonomy or not.
 */
function extractSelfDeclaredSkills(lines: string[]): string[] {
  const found: string[] = [];
  let inSkillsSection = false;
  for (const line of lines) {
    const bare = line.replace(/^[\s•·*-]+/, "").trim();
    if (!bare) continue;
    const headingCandidate = bare.replace(/[:：]\s*$/, "");
    if (headingCandidate.length <= 40 && skillSectionHeading.test(headingCandidate)) {
      inSkillsSection = true;
      const inlineValue = bare.slice(headingCandidate.length).replace(/^[:：]\s*/, "");
      if (inlineValue) found.push(...splitSkillList(inlineValue));
      continue;
    }
    if (!inSkillsSection) continue;
    // A short, non-sentence line under a skills heading; a new ALL-CAPS-ish heading ends the section.
    if (bare.length > 4 && bare.length <= 40 && /^[A-Z][A-Za-z0-9 &/]+$/.test(bare) && !bare.includes(",") && bare.split(" ").length <= 4 && !/\d{4}/.test(bare)) {
      inSkillsSection = false;
      continue;
    }
    if (bare.length > 160) { inSkillsSection = false; continue; }
    found.push(...splitSkillList(bare));
  }
  return found;
}

function splitSkillList(value: string): string[] {
  return value
    .split(/[,|•·;/]|\s{2,}/)
    .map((token) => token.trim().replace(/^[-–—]\s*/, ""))
    .filter((token) => token.length >= 2 && token.length <= 40 && token.split(" ").length <= 5 && !/^\d+$/.test(token));
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

  const taxonomySkills = extractTaxonomySkills(text).map((match) => match.term);
  const selfDeclared = extractSelfDeclaredSkills(lines).map(titleCase);
  // Self-declared skills come straight from the candidate's own resume text, so
  // prefer that casing (e.g. "PostgreSQL") over the taxonomy's generic title-case
  // guess (e.g. "Postgresql") when the same term appears in both lists.
  const skills = dedupeCaseInsensitive([...selfDeclared, ...taxonomySkills]).slice(0, 60);

  const categoryMatches = categorizeText(text).filter((match) => match.score >= 2);
  const domains = categoryMatches.slice(0, 5).map((match) => match.label);

  const evidence = text
    .split(/\n+/)
    .map((line) => line.replace(/^[\s•·*-]+/, "").trim())
    .filter((line) => line.length >= 35 && line.length <= 280)
    .filter((line) => /\d|built|designed|architected|scaled|reduced|improved|migrated|optimized|led|launched|managed|created|drove|delivered|increased|decreased|grew/i.test(line))
    .slice(0, 10);

  const experienceMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:\+\s*)?(?:years?|yrs?)\s+(?:of\s+)?(?:professional\s+)?experience/);

  const primary = categoryMatches[0] ?? null;
  let title = "";
  if (primary) {
    const matchedTitle = primary && skillTaxonomyTitleHit(lower, primary.categoryId);
    title = matchedTitle ? titleCase(matchedTitle) : titleCase(categoryFallbackTitle(primary.categoryId) ?? primary.label);
  }
  if (!title) title = "Professional";

  return {
    name: parsedName,
    email: parsedEmail,
    title,
    experienceYears: experienceMatch ? Number(experienceMatch[1]) : 0,
    skills,
    domains: unique(domains),
    evidence: unique(evidence),
    source: "resume",
  };
}

// Small local helpers that need the taxonomy's title lists; kept here (rather than
// re-exported generically from skill-taxonomy.ts) since they're only meaningful
// paired with the resume-title-inference flow above.
function skillTaxonomyTitleHit(lowerText: string, categoryId: string): string | null {
  const category = skillTaxonomy.find((entry) => entry.id === categoryId);
  if (!category) return null;
  return category.titles.find((title) => lowerText.includes(title.toLowerCase())) ?? null;
}

function categoryFallbackTitle(categoryId: string): string | null {
  const category = skillTaxonomy.find((entry) => entry.id === categoryId);
  return category?.titles[0] ?? null;
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
