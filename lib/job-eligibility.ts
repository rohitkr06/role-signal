import { categoriesForSkills, categoryById } from "./skill-taxonomy.ts";

export type IndiaEligibilityDecision = "ELIGIBLE" | "VERIFY" | "INELIGIBLE";

export type IndiaEligibilityStatus =
  | "INDIA_BASED"
  | "REMOTE_INDIA"
  | "REMOTE_WORLDWIDE"
  | "REMOTE_APAC"
  | "REMOTE_CONTRACTOR"
  | "REMOTE_UNKNOWN"
  | "REMOTE_RESTRICTED"
  | "OTHER_LOCATION";

export type IndiaEligibilityAssessment = {
  decision: IndiaEligibilityDecision;
  status: IndiaEligibilityStatus;
  label: string;
  confidence: "high" | "medium" | "low";
  reasons: string[];
};

type EligibilityInput = {
  location?: string;
  workMode?: string;
  description?: string;
  eligibilityHint?: string;
};

const indiaPlaces = [
  "india", "bengaluru", "bangalore", "hyderabad", "pune", "mumbai", "delhi",
  "gurugram", "gurgaon", "noida", "chennai", "kolkata", "ahmedabad", "kochi",
  "trivandrum", "thiruvananthapuram",
];

function normalized(value = "") {
  return value.toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
}

function containsPlace(text: string, place: string) {
  return new RegExp(`\\b${place.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
}

function result(
  decision: IndiaEligibilityDecision,
  status: IndiaEligibilityStatus,
  label: string,
  confidence: IndiaEligibilityAssessment["confidence"],
  reasons: string[],
): IndiaEligibilityAssessment {
  return { decision, status, label, confidence, reasons };
}

export function assessIndiaEligibility(input: EligibilityInput): IndiaEligibilityAssessment {
  const location = normalized(input.location);
  const description = normalized(input.description);
  const hint = normalized(input.eligibilityHint);
  const text = `${location} ${hint} ${description}`.trim();
  const mode = normalized(input.workMode);
  const remote = mode === "remote" || /\b(remote|work from home|distributed team)\b/.test(`${location} ${description}`);
  const india = indiaPlaces.some((place) => containsPlace(`${location} ${hint}`, place))
    || /\b(country|countries)\s*[:=]?\s*in\b/.test(hint);

  const worldwide = /\b(worldwide|world-wide|work from anywhere|anywhere in the world|global(?:ly)? remote|remote globally|all countries|international candidates? (?:are )?welcome)\b/.test(text)
    || /\bregions?\s*[:=]?\s*global\b/.test(hint);
  const apac = /\b(apac|asia[- ]pacific|across asia|remote in asia)\b/.test(text)
    || /\bregions?\s*[:=]?\s*apac\b/.test(hint);
  const contractor = /\b(international contractors?|global contractors?|contract from anywhere|employer of record|eor|hire globally|global employment)\b/.test(text);

  const restrictedRegion = /\b(?:remote\s*[-–—:]?\s*)?(?:us|u\.s\.|usa|united states|canada|uk|united kingdom|europe|eu|emea|australia|new zealand)\s*(?:only|residents? only|based only)\b/.test(text)
    || /\b(?:must|need to|required to) (?:be )?(?:located|based|reside|live) in (?:the )?(?:us|u\.s\.|usa|united states|canada|uk|united kingdom|europe|eu|emea|australia|new zealand)\b/.test(text)
    || /\b(?:authorized|eligible) to work in (?:the )?(?:us|u\.s\.|usa|united states|canada|uk|united kingdom|europe|eu|australia)\b/.test(text)
    || /\bno (?:visa )?sponsorship\b/.test(text) && /\b(?:us|u\.s\.|usa|united states|canada|uk|united kingdom|europe|eu|australia)\b/.test(text);
  const structuredForeignRestriction = /\b(?:us|u\.s\.|usa|united states|canada|uk|united kingdom|europe|eu|emea|latam|australia|new zealand)\b/.test(`${location} ${hint}`)
    && !india
    && !worldwide
    && !apac;

  if (remote && india) {
    return result("ELIGIBLE", "REMOTE_INDIA", "Remote from India", "high", ["The listing explicitly includes India."]);
  }
  if (!remote && india) {
    return result("ELIGIBLE", "INDIA_BASED", "India-based", "high", ["The job location is in India."]);
  }
  if (remote && (restrictedRegion || structuredForeignRestriction)) {
    return result("INELIGIBLE", "REMOTE_RESTRICTED", "Remote, but location restricted", "high", ["The listing restricts hiring to a region outside India."]);
  }
  if (remote && worldwide) {
    return result("ELIGIBLE", "REMOTE_WORLDWIDE", "Worldwide remote", "high", ["The listing accepts candidates worldwide."]);
  }
  if (remote && apac) {
    return result("ELIGIBLE", "REMOTE_APAC", "APAC remote", "high", ["The listing accepts candidates in APAC or Asia."]);
  }
  if (remote && contractor) {
    return result("ELIGIBLE", "REMOTE_CONTRACTOR", "International contract possible", "medium", ["The listing mentions international contracting or global employment."]);
  }
  if (remote) {
    return result("VERIFY", "REMOTE_UNKNOWN", "Remote eligibility unclear", "low", ["The role is remote, but the listing does not confirm that candidates in India are accepted."]);
  }
  return result("INELIGIBLE", "OTHER_LOCATION", "Outside India", "high", ["The role is outside India and is not described as remote."]);
}

export function expandSearchKeywords(keywords: string[], profile: { title?: string; skills?: string[]; domains?: string[] }) {
  const values = [...keywords];
  const title = (profile.title || "").trim();
  if (title) values.push(title);

  // Legacy synonyms for the software-engineering title shorthand that predates the
  // general taxonomy below. Kept because "SDE 2" / "SDE II" style titles are common
  // enough in Indian job postings that they're worth a direct synonym regardless of
  // whether the general category match below also fires.
  if (/software development engineer ii|sde[- ]?2/i.test(title)) values.push("Software Engineer II", "SDE 2");

  // General case: pull title synonyms from whichever taxonomy categories the
  // candidate's actual skills fall under, so a marketing, sales, design, or any
  // other profile gets the same kind of query expansion an engineering profile does.
  const categoryMatches = categoriesForSkills(profile.skills || []);
  for (const match of categoryMatches.slice(0, 2)) {
    const category = categoryById(match.categoryId);
    if (!category) continue;
    for (const candidateTitle of category.titles.slice(0, 3)) values.push(titleCase(candidateTitle));
  }
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 10);
}

function titleCase(value: string) {
  return value.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}
