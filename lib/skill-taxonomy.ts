/**
 * General-purpose skill/role taxonomy used to extract a candidate's profile from
 * any resume and to classify any job posting, regardless of professional domain.
 *
 * This intentionally stays a curated, deterministic taxonomy rather than a call to
 * an LLM: every match here is auditable back to a literal term in the resume or job
 * description, which is the trust property the rest of RoleSignal depends on. It is
 * meant to be broad enough that a marketing manager, a product designer, and a
 * backend engineer all get meaningfully matched against relevant jobs, not just the
 * software-engineering profile the scorer originally shipped with.
 *
 * Extending this list (new categories, new terms, new title synonyms) is the
 * lowest-risk way to widen who RoleSignal works well for. Prefer adding terms here
 * over adding domain-specific branches inside lib/rolesignal.ts.
 */

export type SkillCategory = {
  id: string;
  label: string;
  /** Canonical job titles/keywords that identify this category from a role title alone. */
  titles: string[];
  /** Skills, tools, and keywords associated with this category. */
  terms: string[];
};

export const skillTaxonomy: SkillCategory[] = [
  {
    id: "software-backend",
    label: "Software Engineering (Backend & Systems)",
    titles: [
      "software engineer", "backend engineer", "back-end engineer", "back end engineer",
      "software development engineer", "sde", "systems engineer", "platform engineer",
      "full stack engineer", "full-stack engineer", "solutions engineer", "staff engineer",
      "principal engineer", "api engineer",
    ],
    terms: [
      "java", "spring", "spring boot", "python", "django", "flask", "fastapi", "golang", "go",
      "c++", "c#", ".net", "node.js", "nodejs", "typescript", "javascript", "nestjs", "php",
      "ruby", "rails", "rest api", "rest apis", "graphql", "grpc", "microservices", "monolith",
      "system design", "distributed systems", "event-driven", "event driven", "message queue",
      "kafka", "rabbitmq", "sqs", "nats", "pub/sub", "pubsub", "webhook", "async", "asynchronous",
      "caching", "redis", "memcached", "sql", "mysql", "postgresql", "postgres", "mongodb",
      "oop", "design patterns", "unit testing", "tdd", "concurrency", "multithreading",
    ],
  },
  {
    id: "frontend-mobile",
    label: "Frontend & Mobile Engineering",
    titles: [
      "frontend engineer", "front-end engineer", "front end engineer", "ui engineer",
      "web developer", "mobile developer", "mobile engineer", "ios developer", "ios engineer",
      "android developer", "android engineer", "react native developer",
    ],
    terms: [
      "react", "react.js", "reactjs", "angular", "vue", "vue.js", "svelte", "next.js", "nextjs",
      "html", "html5", "css", "css3", "tailwind", "sass", "scss", "redux", "webpack", "vite",
      "javascript", "typescript", "swift", "swiftui", "objective-c", "kotlin", "android sdk",
      "jetpack compose", "flutter", "dart", "react native", "responsive design", "accessibility",
      "cross-browser", "progressive web app", "pwa", "figma to code",
    ],
  },
  {
    id: "data-analytics",
    label: "Data Engineering & Analytics",
    titles: [
      "data engineer", "data analyst", "business intelligence analyst", "bi analyst",
      "analytics engineer", "reporting analyst", "database administrator", "dba",
    ],
    terms: [
      "sql", "etl", "elt", "data pipeline", "data warehouse", "data warehousing", "spark",
      "pyspark", "hadoop", "airflow", "dbt", "bigquery", "snowflake", "redshift", "databricks",
      "power bi", "tableau", "looker", "excel", "data modeling", "data governance",
      "kafka", "streaming data", "data quality", "dimensional modeling", "star schema",
    ],
  },
  {
    id: "data-science-ml",
    label: "Data Science & AI/ML",
    titles: [
      "data scientist", "machine learning engineer", "ml engineer", "ai engineer",
      "research scientist", "applied scientist", "nlp engineer", "computer vision engineer",
      "ai/ml engineer",
    ],
    terms: [
      "python", "machine learning", "deep learning", "neural network", "pytorch", "tensorflow",
      "scikit-learn", "keras", "nlp", "natural language processing", "computer vision", "llm",
      "large language model", "generative ai", "genai", "prompt engineering", "rag",
      "retrieval augmented generation", "langchain", "openai", "hugging face", "statistics",
      "a/b testing", "hypothesis testing", "regression", "classification", "feature engineering",
      "model deployment", "mlops", "voice ai", "conversational ai", "ai agent", "agentic",
      "speech recognition", "vector database", "embeddings",
    ],
  },
  {
    id: "cloud-devops-sre",
    label: "Cloud, DevOps & Site Reliability",
    titles: [
      "devops engineer", "site reliability engineer", "sre", "cloud engineer",
      "infrastructure engineer", "platform engineer", "systems administrator", "sysadmin",
      "network engineer", "security engineer",
    ],
    terms: [
      "aws", "azure", "gcp", "google cloud", "kubernetes", "k8s", "docker", "terraform",
      "ansible", "ci/cd", "jenkins", "github actions", "gitlab ci", "observability", "grafana",
      "prometheus", "datadog", "new relic", "sentry", "pagerduty", "incident management",
      "on-call", "reliability", "autoscaling", "load balancing", "networking", "vpc", "iac",
      "infrastructure as code", "linux", "bash", "shell scripting", "cloudformation",
    ],
  },
  {
    id: "qa-testing",
    label: "QA & Test Engineering",
    titles: [
      "qa engineer", "test engineer", "sdet", "quality analyst", "quality assurance engineer",
      "automation engineer",
    ],
    terms: [
      "manual testing", "automation testing", "selenium", "cypress", "playwright", "test cases",
      "test plans", "regression testing", "load testing", "performance testing", "postman",
      "api testing", "bug tracking", "jira", "quality assurance", "test automation framework",
    ],
  },
  {
    id: "product-management",
    label: "Product Management",
    titles: [
      "product manager", "associate product manager", "senior product manager",
      "group product manager", "product owner", "vp of product", "head of product",
      "product lead",
    ],
    terms: [
      "product roadmap", "product strategy", "prd", "product requirements", "user research",
      "user stories", "stakeholder management", "go-to-market", "gtm", "a/b testing",
      "product analytics", "agile", "scrum", "jira", "product-market fit", "competitive analysis",
      "feature prioritization", "okrs", "kpis", "customer discovery", "wireframing",
    ],
  },
  {
    id: "design-ux",
    label: "UX/UI & Product Design",
    titles: [
      "ux designer", "ui designer", "product designer", "graphic designer", "visual designer",
      "interaction designer", "design lead", "ux researcher",
    ],
    terms: [
      "figma", "sketch", "adobe xd", "wireframes", "prototyping", "user research",
      "usability testing", "design systems", "interaction design", "visual design",
      "information architecture", "user personas", "user journeys", "adobe photoshop",
      "adobe illustrator", "typography", "accessibility", "design thinking",
    ],
  },
  {
    id: "marketing-growth",
    label: "Marketing & Growth",
    titles: [
      "marketing manager", "digital marketing manager", "growth marketer", "content marketer",
      "brand manager", "seo specialist", "sem specialist", "performance marketing manager",
      "marketing executive", "growth manager", "social media manager",
    ],
    terms: [
      "seo", "sem", "google ads", "meta ads", "facebook ads", "content marketing",
      "social media marketing", "email marketing", "growth hacking", "brand marketing",
      "campaign management", "google analytics", "marketing automation", "hubspot", "mailchimp",
      "conversion rate optimization", "cro", "influencer marketing", "affiliate marketing",
      "performance marketing", "media planning", "market research", "crm marketing",
    ],
  },
  {
    id: "sales-bd",
    label: "Sales & Business Development",
    titles: [
      "sales executive", "sales manager", "business development manager",
      "business development executive", "account executive", "key account manager",
      "sales director", "regional sales manager", "inside sales",
    ],
    terms: [
      "lead generation", "crm", "salesforce", "hubspot crm", "quota", "sales pipeline",
      "cold calling", "cold outreach", "account management", "b2b sales", "b2c sales",
      "negotiation", "client relationship management", "revenue targets", "sales forecasting",
      "channel sales", "enterprise sales", "solution selling", "prospecting",
    ],
  },
  {
    id: "customer-success",
    label: "Customer Success & Support",
    titles: [
      "customer success manager", "customer support executive", "support engineer",
      "technical support engineer", "customer service representative", "help desk analyst",
    ],
    terms: [
      "customer support", "customer success", "ticketing system", "zendesk", "freshdesk",
      "sla", "onboarding", "customer retention", "churn reduction", "help desk",
      "customer satisfaction", "csat", "nps", "escalation management",
    ],
  },
  {
    id: "finance-accounting",
    label: "Finance & Accounting",
    titles: [
      "financial analyst", "accountant", "finance manager", "chartered accountant",
      "auditor", "controller", "finance business partner", "investment analyst",
      "treasury analyst",
    ],
    terms: [
      "financial modeling", "financial analysis", "gaap", "ifrs", "reconciliation", "tally",
      "sap fico", "quickbooks", "budgeting", "forecasting", "taxation", "gst", "auditing",
      "accounts payable", "accounts receivable", "general ledger", "variance analysis",
      "financial reporting", "cost accounting", "valuation", "excel modeling",
    ],
  },
  {
    id: "human-resources",
    label: "Human Resources",
    titles: [
      "hr manager", "hr business partner", "talent acquisition specialist", "recruiter",
      "hr executive", "people operations manager", "hr generalist", "chro",
    ],
    terms: [
      "recruitment", "talent acquisition", "sourcing", "hris", "payroll", "employee engagement",
      "performance management", "onboarding", "hr policies", "compensation and benefits",
      "workforce planning", "employee relations", "applicant tracking system", "ats",
      "learning and development", "organizational development",
    ],
  },
  {
    id: "operations-supply-chain",
    label: "Operations & Supply Chain",
    titles: [
      "operations manager", "supply chain analyst", "logistics manager", "procurement manager",
      "warehouse manager", "operations executive", "supply chain manager",
    ],
    terms: [
      "logistics", "supply chain management", "inventory management", "procurement",
      "vendor management", "warehouse operations", "six sigma", "lean manufacturing",
      "process improvement", "demand planning", "erp", "sap", "distribution management",
      "fleet management", "quality control",
    ],
  },
  {
    id: "project-program-management",
    label: "Project & Program Management",
    titles: [
      "project manager", "program manager", "scrum master", "delivery manager",
      "technical program manager", "tpm", "pmo lead",
    ],
    terms: [
      "project planning", "scrum master", "pmp", "prince2", "agile", "risk management",
      "stakeholder communication", "gantt chart", "pmo", "resource planning", "sprint planning",
      "project delivery", "budget management", "cross-functional coordination",
    ],
  },
  {
    id: "legal-compliance",
    label: "Legal & Compliance",
    titles: [
      "legal counsel", "compliance officer", "paralegal", "legal advisor", "corporate lawyer",
      "legal manager", "regulatory affairs manager",
    ],
    terms: [
      "contract drafting", "contract negotiation", "compliance", "litigation", "legal research",
      "regulatory affairs", "corporate law", "intellectual property", "due diligence",
      "risk assessment", "policy drafting", "data privacy law", "gdpr",
    ],
  },
  {
    id: "content-communications",
    label: "Content & Communications",
    titles: [
      "content writer", "copywriter", "content strategist", "technical writer", "editor",
      "pr manager", "communications manager", "journalist",
    ],
    terms: [
      "copywriting", "content strategy", "editing", "proofreading", "journalism",
      "technical writing", "public relations", "content calendar", "storytelling",
      "seo writing", "social media content", "blogging", "brand voice", "press releases",
    ],
  },
  {
    id: "healthcare",
    label: "Healthcare & Life Sciences",
    titles: [
      "clinical research associate", "registered nurse", "medical officer",
      "pharmacovigilance associate", "healthcare administrator", "physician", "pharmacist",
    ],
    terms: [
      "clinical research", "clinical trials", "patient care", "pharmacovigilance", "nursing",
      "medical coding", "healthcare administration", "electronic health records", "ehr",
      "regulatory submissions", "gcp compliance", "medical writing",
    ],
  },
  {
    id: "education-training",
    label: "Education & Training",
    titles: [
      "teacher", "trainer", "instructional designer", "academic coordinator",
      "curriculum developer", "training manager", "professor", "lecturer",
    ],
    terms: [
      "curriculum design", "lesson planning", "teaching", "instructional design", "lms",
      "training delivery", "e-learning", "classroom management", "student assessment",
      "corporate training", "facilitation",
    ],
  },
];

const stopSkillTerms = new Set(["engineer", "engineering", "software", "developer", "manager"]);

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[‐-―]/g, "-").replace(/\s+/g, " ").trim();
}

function containsTerm(text: string, term: string) {
  // Word-boundary match for short/alphanumeric terms; substring match for phrases
  // that contain punctuation (like "c++" or "ci/cd") where \b doesn't apply cleanly.
  if (/^[a-z0-9][a-z0-9 ]*[a-z0-9]$|^[a-z0-9]$/.test(term)) {
    return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
  }
  return text.includes(term);
}

export type CategoryMatch = {
  categoryId: string;
  label: string;
  matchedTerms: string[];
  titleHit: boolean;
  score: number;
};

/**
 * Scores every taxonomy category against a block of text (a resume, or a job
 * title + description). Term hits count for 1 point each; a title-phrase hit
 * (the text mentions a canonical title for the category) counts extra, since a
 * job's own title is usually the strongest signal of what family it belongs to.
 */
export function categorizeText(rawText: string): CategoryMatch[] {
  const text = ` ${normalizeText(rawText)} `;
  return skillTaxonomy
    .map((category) => {
      const matchedTerms = category.terms.filter((term) => containsTerm(text, term));
      const titleHit = category.titles.some((title) => text.includes(normalizeText(title)));
      const score = matchedTerms.length + (titleHit ? 3 : 0);
      return { categoryId: category.id, label: category.label, matchedTerms, titleHit, score };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** The single strongest category match for a block of text, if any. */
export function primaryCategory(rawText: string): CategoryMatch | null {
  const matches = categorizeText(rawText);
  return matches[0] ?? null;
}

/**
 * Extracts every taxonomy skill/tool term present in a resume, tagged with the
 * category it belongs to and using the term's canonical (title-cased) form for
 * display. This is the general-purpose replacement for a single hardcoded
 * skill list: any resume that mentions terms from any category gets picked up.
 */
export function extractTaxonomySkills(rawText: string): Array<{ term: string; categoryId: string }> {
  const text = ` ${normalizeText(rawText)} `;
  const found = new Map<string, string>();
  for (const category of skillTaxonomy) {
    for (const term of category.terms) {
      const key = term.toLowerCase();
      if (found.has(key)) continue;
      if (containsTerm(text, term)) found.set(key, category.id);
    }
  }
  return [...found.entries()].map(([term, categoryId]) => ({ term: displayTerm(term), categoryId }));
}

const knownAcronyms = new Set([
  "sql", "api", "apis", "aws", "gcp", "ci/cd", "sre", "seo", "sem", "crm", "hris", "gaap",
  "ifrs", "gst", "sap", "sap fico", "pmp", "prince2", "gdpr", "erp", "ats", "nlp", "llm",
  "genai", "mlops", "iac", "csat", "nps", "sla", "html", "html5", "css", "css3", "ios",
  "k8s", "vpc", "rag", "cro", "tdd", "oop", "dba", "etl", "elt", "bi", "vp",
]);

function displayTerm(term: string) {
  if (knownAcronyms.has(term)) return term.toUpperCase();
  return term.replace(/(^|[\s/-])([a-z])/g, (_match, sep, char) => `${sep}${char.toUpperCase()}`);
}

/** Public alias of the display-casing helper, for callers outside this module. */
export function formatSkillTerm(term: string) {
  return displayTerm(term.toLowerCase());
}

/**
 * Given a set of already-matched skill terms, returns the category id each one
 * belongs to. Used to compute which taxonomy categories a candidate's *stored*
 * skills list (which may already be a cleaned/edited list, not raw resume text)
 * actually falls under.
 */
export function categoriesForSkills(skills: string[]): CategoryMatch[] {
  const lowered = skills.map((skill) => skill.toLowerCase());
  return skillTaxonomy
    .map((category) => {
      const matchedTerms = category.terms.filter((term) => lowered.includes(term.toLowerCase()));
      return { categoryId: category.id, label: category.label, matchedTerms, titleHit: false, score: matchedTerms.length };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score);
}

export function categoryById(categoryId: string) {
  return skillTaxonomy.find((category) => category.id === categoryId) ?? null;
}

export function isGenericStopTerm(term: string) {
  return stopSkillTerms.has(term.toLowerCase());
}
