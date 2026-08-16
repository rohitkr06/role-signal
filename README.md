# RoleSignal

RoleSignal is an explainable job-matching and approval-first application workspace for backend engineers. It optimizes for interview probability, role quality, and career upside instead of application volume.

## Phase 2 capabilities

- Extracts text from PDF, DOCX, and TXT resumes and stores the source file in R2.
- Maintains a verified career profile in D1 without inventing unsupported claims.
- Imports individual job pages or scans public Greenhouse and Lever boards.
- Scores every role with a transparent 100-point backend-engineering rubric.
- Separates language mismatch from engineering-domain mismatch.
- Deduplicates on company, role, and location while preferring official URLs.
- Prepares application packets, resume-ordering guidance, blockers, and an audit trail.
- Includes a Chrome companion that fills supported fields but never submits.

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

The extension source is in `browser-extension/`. Load it unpacked from `chrome://extensions`, or download the generated zip from the running app.

## Publish to GitHub

Create an empty repository on GitHub, then add it as the local `origin` and push `main`. No API keys are committed. Hosted resource bindings remain represented by logical names in `.openai/hosting.json`.

## Architecture

- Vinext / React 19 interface
- Cloudflare Worker API
- D1 for profiles, job matches, preferences, packets, and audit events
- R2 for resume files
- Drizzle schema and checked-in SQL migrations
- Public Greenhouse Job Board and Lever Postings APIs for source scanning

The OpenAI analysis path is intentionally not enabled until a server-side API key is configured. The current release uses deterministic, auditable extraction and scoring.
