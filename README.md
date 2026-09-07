# RoleSignal

RoleSignal is an explainable job-discovery and assisted-application workspace for job seekers in India. It ranks opportunities against resume evidence, keeps every generated claim traceable, and never silently submits an application.

## Trustworthy MVP

- Uploads PDF, DOCX, or TXT resumes into a draft profile that must be reviewed before it becomes active.
- Versions the active resume evidence. A newly confirmed version makes older scores, packets, documents, and queued executions stale so candidate data cannot leak between profiles.
- Runs one ranked search across Jobicy, Arbeitnow, optional Adzuna, optional Jooble, optional Google Jobs via SerpApi, and connected Greenhouse, Lever, or Ashby company boards.
- Reports real connector health—last attempt, response count, accepted jobs, latency, and errors—instead of displaying static “live” badges.
- Imports LinkedIn, Naukri, Indeed, Foundit, Workday, and other portal alert emails without storing portal passwords or scraping protected pages.
- Searches Freehire's public ATS catalog for India and worldwide-remote roles and Remotive's public remote feed without requiring API keys.
- Labels each match as India-ready, eligibility-needs-verification, or location-restricted before any automatic preparation.
- Deduplicates imported listings and scores them using only the active, user-confirmed resume evidence.
- Matches resumes against a general, multi-domain skill taxonomy (software engineering, data, product, design, marketing, sales, finance, operations, and more — see `lib/skill-taxonomy.ts`) rather than a single hardcoded profession, so discovery and scoring work for any resume someone uploads, not only backend engineers.
- Prepares grounded application packets, tailored resumes, cover notes, and reusable answers with an audit trail.
- Queues only applications explicitly approved for filling. The Chrome companion fills recognized fields and pauses before submission.
- Stops for CAPTCHAs, missing required answers, unsupported controls, stale evidence, and any state it cannot safely verify.
- Keeps sample opportunities out of live counts and clearly shows an empty state when no verified jobs have been found.

## Safety model

Unknown compensation, notice-period, work-authorization, legal, relocation, and demographic answers are marked `NEEDS_INPUT`. CAPTCHAs and access controls are never bypassed. The browser companion is host-locked and final submission always remains manual.

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` if you want to enable the optional Adzuna, Jooble, Google Jobs, or inbound-email connectors. Never commit real keys.

Build and validate:

```bash
npm test
```

Generate a migration after changing `db/schema.ts`:

```bash
npm run db:generate
```

## Browser companion

The extension source is in `browser-extension/`. Load it unpacked from `chrome://extensions`, or download the generated zip from the running app. Version 0.8 pairs with the guarded execution queue, fills approved applications, captures visible jobs from supported portals including Weekday, uploads the selected resume, and pauses before final submission. Protected portals are covered through their job-alert emails and browser-assisted capture rather than credential scraping.

## Publish to GitHub

Create an empty repository on GitHub, then add it as the local `origin` and push `main`. No API keys are committed. Hosted resource bindings remain represented by logical names in `.openai/hosting.json`.

## Architecture

- Vinext / React 19 interface
- Cloudflare Worker API
- D1 for profiles, job matches, preferences, verified answers, saved discovery searches, automation schedules, alerts, discovery runs, application kits, tailored document versions, execution policies, paired devices, application executions, packets, and audit events
- R2 for source resumes and approved DOCX/PDF exports
- Drizzle schema and checked-in SQL migrations
- Public Greenhouse, Lever, Ashby, Jobicy, and Arbeitnow feeds, with optional Adzuna, Jooble, and Google Jobs connectors for server-side discovery
- Cloudflare Cron Trigger for hourly due-search processing
- Portal alert ingestion for job sites that depend on a signed-in user session

The OpenAI analysis path is intentionally not enabled until a server-side API key is configured. The current release uses deterministic, auditable extraction and scoring.
