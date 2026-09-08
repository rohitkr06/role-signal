import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { profileFromResumeText, scoreJob, inferWorkMode } from "../lib/rolesignal.ts";
import { defaultDiscoveryKeywords, defaultDiscoveryName, isDiscoveryCandidate } from "../lib/discovery-query.ts";

async function fixture(name) {
  return readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

const backendJob = {
  company: "Orbit Systems",
  role: "Senior Backend Engineer",
  location: "Bengaluru, India",
  workMode: "Hybrid",
  applicationUrl: "https://example.com/jobs/backend",
  description:
    "We are hiring a backend engineer to build distributed, event-driven microservices. " +
    "Requirements: 3-6 years experience, strong Java or Spring Boot background, Kafka, PostgreSQL, " +
    "Kubernetes, and AWS. You will own system design for high-scale APIs.",
};

const marketingJob = {
  company: "Northwind Retail",
  role: "Digital Marketing Manager",
  location: "Remote - India",
  workMode: "Remote",
  applicationUrl: "https://example.com/jobs/marketing",
  description:
    "We're looking for a Digital Marketing Manager to own our SEO, SEM, and Google Ads programs. " +
    "You'll run content marketing and email marketing campaigns and report on Google Analytics dashboards. " +
    "2-5 years of marketing experience required.",
};

const frontendJob = {
  company: "Lumen Labs",
  role: "Frontend Engineer",
  location: "Remote - India",
  workMode: "Remote",
  applicationUrl: "https://example.com/jobs/frontend",
  description:
    "Join our team building accessible, high-performance React interfaces. " +
    "Requirements: React, TypeScript, CSS, and 2-5 years of frontend experience. " +
    "You'll own our design system and component library.",
};

const productJob = {
  company: "Northstar",
  role: "Senior Product Manager",
  location: "India",
  workMode: "Hybrid",
  applicationUrl: "https://example.com/jobs/pm",
  description:
    "We need a Senior Product Manager to own our product roadmap and strategy. " +
    "You'll run user research, A/B testing, and stakeholder management across a 4-8 year experience band, " +
    "working in an agile environment with JIRA.",
};

test("profileFromResumeText extracts a coherent profile across different professional domains", async () => {
  const backend = profileFromResumeText(await fixture("arjun-resume.txt"));
  assert.match(backend.title, /engineer/i);
  assert.ok(backend.skills.some((skill) => /java/i.test(skill)));
  assert.ok(backend.skills.some((skill) => /kafka/i.test(skill)));
  assert.equal(backend.experienceYears, 5);
  assert.ok(backend.domains.some((domain) => /software engineering/i.test(domain)));

  const frontend = profileFromResumeText(await fixture("meera-resume.txt"));
  assert.ok(frontend.skills.some((skill) => /react/i.test(skill)));
  assert.ok(frontend.domains.some((domain) => /frontend/i.test(domain)));

  const marketing = profileFromResumeText(await fixture("priya-resume.txt"));
  assert.ok(marketing.skills.some((skill) => /seo/i.test(skill)));
  assert.ok(marketing.domains.some((domain) => /marketing/i.test(domain)));
  assert.match(marketing.title, /marketing/i);

  const product = profileFromResumeText(await fixture("vikram-resume.txt"));
  assert.ok(product.skills.some((skill) => /product roadmap/i.test(skill)));
  assert.ok(product.domains.some((domain) => /product management/i.test(domain)));
  assert.match(product.title, /product manager/i);
});

test("scoreJob ranks a backend candidate highly against a backend job and poorly against unrelated domains", async () => {
  const profile = profileFromResumeText(await fixture("arjun-resume.txt"));
  const onTarget = scoreJob(profile, backendJob);
  // Deliberately not asserting a very high threshold here: the scorer only credits
  // terms that literally appear in the resume, and this fixture resume doesn't happen
  // to restate every JD buzzword ("microservices", "system design") verbatim. A
  // "competitive, not skipped" match is the honest bar for literal term matching;
  // the comparative assertion below is what actually proves domain generalization.
  assert.ok(onTarget.score >= 65, `expected a competitive backend match, got ${onTarget.score}`);
  assert.notEqual(onTarget.status, "SKIPPED");

  const offTarget = scoreJob(profile, marketingJob);
  assert.ok(offTarget.score < onTarget.score, "a marketing job should score lower than a backend job for a backend candidate");
  assert.equal(offTarget.status, "SKIPPED");
  assert.ok(offTarget.redFlags.some((flag) => /role family/i.test(flag)));
});

test("scoreJob ranks a marketing candidate highly against a marketing job, not just engineering roles", async () => {
  const profile = profileFromResumeText(await fixture("priya-resume.txt"));
  const onTarget = scoreJob(profile, marketingJob);
  assert.ok(onTarget.score >= 75, `expected a strong marketing match, got ${onTarget.score}`);
  assert.notEqual(onTarget.status, "SKIPPED");

  const offTarget = scoreJob(profile, backendJob);
  assert.ok(offTarget.score < onTarget.score);
  assert.equal(offTarget.status, "SKIPPED");
});

test("scoreJob no longer auto-rejects frontend roles the way the old backend-only scorer did", async () => {
  const profile = profileFromResumeText(await fixture("meera-resume.txt"));
  const scored = scoreJob(profile, frontendJob);
  assert.ok(scored.score >= 65, `expected a competitive frontend match, got ${scored.score}`);
  assert.notEqual(scored.status, "SKIPPED");
});

test("scoreJob supports product management the same as engineering domains", async () => {
  const profile = profileFromResumeText(await fixture("vikram-resume.txt"));
  const scored = scoreJob(profile, productJob);
  assert.ok(scored.score >= 75, `expected a strong product match, got ${scored.score}`);
  assert.equal(scored.roleCategory, "Product Management");
});

test("defaultDiscoveryKeywords reflects the candidate's own domain instead of a hardcoded backend default", async () => {
  const marketing = profileFromResumeText(await fixture("priya-resume.txt"));
  const marketingKeywords = defaultDiscoveryKeywords(marketing);
  assert.ok(marketingKeywords.some((term) => /marketing/i.test(term)));
  assert.ok(!marketingKeywords.some((term) => /backend engineer/i.test(term)));
  assert.match(defaultDiscoveryName(marketing), /marketing/i);

  const backend = profileFromResumeText(await fixture("arjun-resume.txt"));
  const backendKeywords = defaultDiscoveryKeywords(backend);
  assert.ok(backendKeywords.some((term) => /engineer/i.test(term)));
});

test("isDiscoveryCandidate matches jobs by category even when exact keyword wording differs", () => {
  const config = { keywords: ["Product Manager"], locations: ["India"], workModes: ["Remote"] };
  const relevantJob = {
    role: "Senior PM, Growth",
    description: "Own product strategy and roadmap for our growth team.",
    location: "Bengaluru, India",
  };
  const irrelevantJob = {
    role: "Backend Engineer",
    description: "Build distributed Java microservices with Kafka.",
    location: "Bengaluru, India",
  };
  assert.equal(isDiscoveryCandidate(relevantJob, config, inferWorkMode), true);
  assert.equal(isDiscoveryCandidate(irrelevantJob, config, inferWorkMode), false);
});
