/**
 * Builds default discovery search keywords/names from a candidate's actual
 * profile, and decides whether a discovered job posting is relevant to a
 * search, without assuming the candidate is a software engineer.
 *
 * This used to be inlined in worker/index.ts with a hardcoded
 * `["Backend Engineer", "Software Engineer", "Platform Engineer", "Node.js"]`
 * default and a hardcoded backend-only regex fallback for role relevance -
 * meaning discovery itself was biased toward one profession before scoring
 * ever ran. Pulling it out into its own module makes it unit-testable and
 * keeps it in sync with the general skill taxonomy used everywhere else.
 */
import { categoriesForSkills, categoryById, primaryCategory } from "./skill-taxonomy.ts";

export type DiscoveryProfileLike = {
  title?: string;
  skills?: string[];
  domains?: string[];
};

function titleCase(value: string) {
  return value.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}

/** A last-resort, multi-domain fallback used only when we have no signal about the candidate at all. */
const UNKNOWN_PROFILE_FALLBACK = ["Software Engineer", "Product Manager", "Marketing Manager", "Sales Executive"];

export function defaultDiscoveryKeywords(profile: DiscoveryProfileLike): string[] {
  const values: string[] = [];
  if (profile.title?.trim()) values.push(profile.title.trim());
  const categoryMatches = categoriesForSkills(profile.skills ?? []);
  for (const match of categoryMatches.slice(0, 2)) {
    const category = categoryById(match.categoryId);
    if (!category) continue;
    values.push(...category.titles.slice(0, 2).map(titleCase));
  }
  if (!values.length) values.push(...UNKNOWN_PROFILE_FALLBACK);
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 6);
}

export function defaultDiscoveryName(profile: DiscoveryProfileLike): string {
  const [primary] = defaultDiscoveryKeywords(profile);
  return primary ? `${primary} roles / India + Global Remote` : "My roles / India + Global Remote";
}

export type DiscoveryJobLike = {
  role: string;
  description: string;
  location: string;
  workMode?: string;
  eligibilityHint?: string;
};

export type DiscoveryConfigLike = {
  keywords: string[];
  locations: string[];
  workModes: string[];
};

const genericTitleWords = new Set(["engineer", "engineering", "software", "developer", "manager", "specialist", "executive", "associate", "senior", "lead", "analyst"]);

export function isDiscoveryCandidate(job: DiscoveryJobLike, config: DiscoveryConfigLike, inferWorkMode: (location: string, description: string) => string): boolean {
  const role = job.role.toLowerCase();
  const description = job.description.toLowerCase();
  const targetTerms = config.keywords.flatMap((keyword) => {
    const normalized = keyword.toLowerCase().trim();
    const tokens = normalized.split(/[^a-z0-9+#.]+/).filter((token) => token.length >= 3 && !genericTitleWords.has(token));
    return [normalized, ...tokens];
  });
  let roleRelevant = targetTerms.some((term) => term.length > 0 && role.includes(term));
  if (!roleRelevant && config.keywords.length) {
    // Fuzzy fallback: same taxonomy category, even if the exact wording differs
    // (e.g. keyword "Product Manager" vs a posting titled "Senior PM, Growth").
    const jobCategory = primaryCategory(`${job.role} ${job.description}`);
    const keywordCategory = primaryCategory(config.keywords.join(" "));
    roleRelevant = Boolean(jobCategory && keywordCategory && jobCategory.categoryId === keywordCategory.categoryId);
  }
  if (!roleRelevant) return false;

  const mode = (job.workMode || inferWorkMode(job.location, description)).toLowerCase();
  const location = `${job.location} ${job.eligibilityHint || ""}`.toLowerCase();
  const locationRelevant = config.locations.some((wanted) => {
    const value = wanted.toLowerCase();
    if (value === "remote") return mode === "remote" || /worldwide|anywhere/.test(location);
    if (value === "apac") return /apac|asia|india|singapore|australia|remote|worldwide|anywhere/.test(location);
    return location.includes(value);
  });
  return locationRelevant || (config.workModes.some((value) => value.toLowerCase() === "remote") && mode === "remote");
}
