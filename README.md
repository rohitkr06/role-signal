# RoleSignal

RoleSignal is an explainable job-matching and approval-first application workspace for backend engineers. It optimizes for interview probability, role quality, and career upside instead of application volume.

## Phase 6 capabilities

- Creates a versioned, role-specific ATS resume from the current verified career profile.
- Reorders skills and impact evidence against each saved job description without inventing experience.
- Adds an editable cover note and reusable written application answers for each role.
- Maintains claim-level provenance and revalidates edited text against resume, profile, job, and answer-vault sources.
- Blocks approval when an edited claim has no supporting evidence.
- Generates approved DOCX and PDF resumes in R2 and exposes owner-checked download routes.
- Keeps earlier approved versions downloadable while clearly marking superseded versions.

- Extracts text from PDF, DOCX, and TXT resumes and stores the source file in R2.
- Maintains a verified career profile in D1 without inventing unsupported claims.
- Imports individual job pages or scans public Greenhouse, Lever, and Ashby boards.
- Scores every role with a transparent 100-point backend-engineering rubric.
- Separates language mismatch from engineering-domain mismatch.
- Deduplicates on company, role, and location while preferring official URLs.
- Prepares application packets, resume-ordering guidance, blockers, and an audit trail.
- Includes a Chrome companion that fills supported fields but never submits.
- Runs every connected source in one resilient batch and keeps a durable search report.
- Ranks a focused top three across companies and exports the full run as Markdown.
- Stores recurring, explicitly verified application answers in a private answer vault.
- Generates reusable application kits with role strategy, a grounded `why this role` answer, resume changes, and supporting evidence.
- Exports the application ledger as CSV for portfolio analysis or follow-up tracking.
- Runs a saved discovery profile across Jobicy, Arbeitnow, and every connected company ATS board.
- Enforces an hourly public-feed refresh window, normalizes provider data, and merges duplicate roles.
- Launches targeted LinkedIn, Naukri, Indeed, and wider web searches from one Discovery workspace.
- Imports visible LinkedIn, Naukri, Workday, Indeed, and company-portal job cards captured by the Chrome companion.
- Keeps public-feed runs and authenticated portal captures in one durable discovery history.
- Runs an hourly Cloudflare Worker pulse and executes each saved search only when its chosen cadence is due.
- Stores automation health, next-run timing, failures, and a deduplicated Signal inbox in D1.
- Sends opt-in browser notifications for newly qualified matches while keeping the in-app inbox authoritative.
- Scans public Ashby job boards alongside Greenhouse and Lever, including full descriptions and compensation when published.
- Launches searches across LinkedIn, Naukri, Indeed, Wellfound, Cutshort, Instahyre, Hirist, Foundit, Google Jobs, and YC Startups.
- Retrieves the full official job page on demand, reads JobPosting structured data, and rescores the role.
- Uses an explainable evidence-semantic graph to translate Kafka/queue, cloud, caching, orchestration, data-scale, reliability, and AI-agent requirements into verified transferable experience.

## Safety model

Unknown compensation, notice-period, work-authorization, legal, relocation, and demographic answers are marked `NEEDS_INPUT`. CAPTCHAs and access controls are never bypassed. The browser companion is host-locked and final submission always remains manual.

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Build and validate:

```bash
npm test
```

Generate a migration after changing `db/schema.ts`:

```bash
npm run db:generate
```

## Browser companion

The extension source is in `browser-extension/`. Load it unpacked from `chrome://extensions`, or download the generated zip from the running app. Version 0.5 can capture job cards visible across the expanded portal set and copy a normalized discovery batch back to RoleSignal.

## Publish to GitHub

Create an empty repository on GitHub, then add it as the local `origin` and push `main`. No API keys are committed. Hosted resource bindings remain represented by logical names in `.openai/hosting.json`.

## Architecture

- Vinext / React 19 interface
- Cloudflare Worker API
- D1 for profiles, job matches, preferences, verified answers, saved discovery searches, automation schedules, alerts, discovery runs, application kits, tailored document versions, packets, and audit events
- R2 for source resumes and approved DOCX/PDF exports
- Drizzle schema and checked-in SQL migrations
- Public Greenhouse, Lever, Ashby, Jobicy, and Arbeitnow feeds for server-side discovery
- Cloudflare Cron Trigger for hourly due-search processing
- Browser-assisted capture for portals that depend on a signed-in user session

The OpenAI analysis path is intentionally not enabled until a server-side API key is configured. The current release uses deterministic, auditable extraction and scoring.
